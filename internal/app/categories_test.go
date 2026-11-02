package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Synthetic markup, intentionally unrelated to the live account's catalogue.
const categoryMarkup = `<section class="kp-section kp-cats-sec" id="sc_92"><h2>ignored<span>Dynamic &amp; category</span><span>1</span></h2><div class="kp-selection" id="selection_731"><a href="/selection/view/731"><img src="https://images.example/poster.jpg"><span class="kp-poster-title">First <b>collection</b></span><span class="kp-rating-pill" title="Смотрят">12</span><span class="kp-rating-pill" title="Фильмов">3</span><span class="kp-rating-pill" title="Просмотров">1 K</span></a></div></section><section class="kp-cats-sec" id="sc_none"><h2><span>Uncategorized</span></h2></section>`

func TestCategoryParser(t *testing.T) {
	groups, err := parseCategories(categoryMarkup)
	require(t, err == nil && len(groups) == 2, "categories not parsed")
	require(t, groups[0].ID == "92" && groups[0].Title == "Dynamic & category", "category metadata changed")
	item := groups[0].Items[0]
	require(t, item.ID == 731 && item.Title == "First collection" && item.Count == "3" && item.Watchers == "12" && item.Views == "1 K" && item.Posters["medium"] == "https://images.example/poster.jpg", "card metadata changed")
	require(t, groups[1].ID == "none" && len(groups[1].Items) == 0, "empty category lost")
	for _, body := range []string{"", `<form id="login-form"></form>`, strings.Replace(categoryMarkup, "selection_731", "invalid", 1), strings.Replace(categoryMarkup, "kp-poster-title", "removed-title", 1), strings.Replace(categoryMarkup, "sc_92", "", 1), strings.Replace(categoryMarkup, "Dynamic &amp; category", "", 1)} {
		_, err := parseCategories(body)
		require(t, err != nil, "malformed/login page accepted")
	}
	for _, value := range []string{"%", "http://images.example/poster.jpg", "https:///missing-host", "https://user:pass@images.example/a", "javascript:alert(1)"} {
		require(t, categoryPoster(value) == "", "unsafe poster accepted")
	}
}

func TestCategorySourceCacheAndIsolation(t *testing.T) {
	source := newCategorySource("test-session=secret")
	now := time.Unix(100, 0)
	source.now = func() time.Time { return now }
	calls := 0
	source.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		require(t, r.URL.String() == categoriesPage && r.Header.Get("Cookie") == "test-session=secret" && r.Header.Get("Authorization") == "", "website session crossed boundary")
		body := categoryMarkup
		if calls > 1 {
			body = strings.ReplaceAll(body, "Dynamic &amp; category", "Changed upstream")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	first, err := source.load(context.Background())
	require(t, err == nil && first[0].Title == "Dynamic & category", "initial fetch failed")
	_, err = source.load(context.Background())
	require(t, err == nil && calls == 1, "cache not used")
	now = now.Add(31 * time.Second)
	next, err := source.load(context.Background())
	require(t, err == nil && calls == 2 && next[0].Title == "Changed upstream", "stale snapshot retained")
}

func TestCategorySourceErrorsAndRedirects(t *testing.T) {
	source := newCategorySource("")
	_, err := source.load(context.Background())
	require(t, errors.Is(err, errCategoriesLogin), "missing session accepted")
	source.cookie = "test-session=secret"
	for _, status := range []int{302, 401, 403, 500} {
		source.client = upstream(status, "private upstream content")
		_, err := source.load(context.Background())
		expected := errCategoriesLogin
		if status == 500 {
			expected = errCategoriesSource
		}
		require(t, errors.Is(err, expected), "upstream status leaked")
	}
	source.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("private transport details") })}
	_, err = source.load(context.Background())
	require(t, err == errCategoriesSource, "transport error leaked")
	source.client = upstream(200, strings.Repeat("a", categoriesLimit+1))
	_, err = source.load(context.Background())
	require(t, err == errCategoriesSource, "oversized source accepted")
	source.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(errorReader{})}, nil
	})}
	_, err = source.load(context.Background())
	require(t, err == errCategoriesSource, "read error accepted")
	source.client = upstream(200, "unexpected HTML")
	_, err = source.load(context.Background())
	require(t, err == errCategoriesSource, "unexpected document accepted")
	source = newCategorySource("test-session=secret")
	calls := 0
	source.client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://other.example/login"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	_, err = source.load(context.Background())
	require(t, err == errCategoriesLogin && calls == 1, "redirect followed with session")
}

func TestCategoriesEndpoint(t *testing.T) {
	a := newApp(config{}, nil)
	a.categories = newCategorySource("test-session=secret")
	a.categories.client = upstream(200, categoryMarkup)
	request := httptest.NewRequest("GET", "/api/collections/categories", nil)
	request.Header.Set("Origin", "https://lampa.example")
	response := httptest.NewRecorder()
	a.ServeHTTP(response, request)
	require(t, response.Code == 200 && response.Header().Get("Access-Control-Allow-Origin") == "*" && strings.Contains(response.Body.String(), `"id":"92"`), "public category metadata endpoint failed")
	require(t, !strings.Contains(response.Body.String(), "secret") && !strings.Contains(response.Body.String(), "<section"), "website session or HTML exposed")
	a.categories = newCategorySource("")
	response = httptest.NewRecorder()
	a.ServeHTTP(response, request)
	require(t, response.Code == 503 && strings.Contains(response.Body.String(), "categories_login_required"), "missing website session not explained")
	c, err := loadConfig(func(key string) string {
		if key == "KINOWATCH_COOKIE" {
			return "test-session=secret"
		}
		return ""
	})
	require(t, err == nil && c.kinoWatchCookie == "test-session=secret", "session configuration missing")
}
