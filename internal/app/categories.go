package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html"
)

const categoriesPage = "https://kino.watch/selection/categories"
const categoriesLimit = 4 << 20

var errCategoriesLogin = errors.New("categories_login_required")
var errCategoriesSource = errors.New("categories_unavailable")

type websiteCollection struct {
	ID       int               `json:"id"`
	Title    string            `json:"title"`
	Posters  map[string]string `json:"posters"`
	Count    string            `json:"count"`
	Watchers string            `json:"watchers"`
	Views    string            `json:"views"`
}
type websiteCategory struct {
	ID    string              `json:"id"`
	Title string              `json:"title"`
	Items []websiteCollection `json:"items"`
}

type categorySource struct {
	cookie string
	client *http.Client
	now    func() time.Time
	mu     sync.Mutex
	until  time.Time
	cached []websiteCategory
}

func newCategorySource(cookie string) *categorySource {
	return &categorySource{cookie: cookie, now: time.Now, client: &http.Client{
		Timeout: 15 * time.Second,
		// Never forward the site's session to a redirect target.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport:     &http.Transport{Proxy: nil, ForceAttemptHTTP2: true},
	}}
}

func (s *categorySource) load(ctx context.Context) ([]websiteCategory, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.now().Before(s.until) {
		return s.cached, nil
	}
	if s.cookie == "" {
		return nil, errCategoriesLogin
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, categoriesPage, nil)
	req.Header.Set("Cookie", s.cookie)
	req.Header.Set("Accept", "text/html")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, errCategoriesSource
	}
	defer resp.Body.Close()
	if resp.StatusCode == 302 || resp.StatusCode == 401 || resp.StatusCode == 403 {
		return nil, errCategoriesLogin
	}
	if resp.StatusCode != http.StatusOK {
		return nil, errCategoriesSource
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, categoriesLimit+1))
	if err != nil || len(body) > categoriesLimit {
		return nil, errCategoriesSource
	}
	categories, err := parseCategories(string(body))
	if err != nil {
		return nil, err
	}
	s.cached = categories
	s.until = s.now().Add(30 * time.Second)
	return categories, nil
}

func nodeAttr(n *html.Node, name string) string {
	for _, a := range n.Attr {
		if a.Key == name {
			return a.Val
		}
	}
	return ""
}
func nodeClass(n *html.Node, name string) bool {
	for _, class := range strings.Fields(nodeAttr(n, "class")) {
		if class == name {
			return true
		}
	}
	return false
}
func nodeText(n *html.Node) string {
	var text strings.Builder
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.TextNode {
			text.WriteString(n.Data)
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(n)
	return strings.Join(strings.Fields(text.String()), " ")
}
func categoryPoster(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return ""
	}
	return raw
}
func parseCategories(body string) ([]websiteCategory, error) {
	root, _ := html.Parse(strings.NewReader(body))
	var categories []websiteCategory
	for section := range root.Descendants() {
		if section.Data != "section" || !nodeClass(section, "kp-cats-sec") {
			continue
		}
		category := websiteCategory{ID: strings.TrimPrefix(nodeAttr(section, "id"), "sc_"), Items: []websiteCollection{}}
		for n := range section.Descendants() {
			if n.Data == "h2" {
				for child := n.FirstChild; child != nil; child = child.NextSibling {
					if child.Data == "span" {
						category.Title = nodeText(child)
						break
					}
				}
			}
			if !nodeClass(n, "kp-selection") {
				continue
			}
			id, _ := strconv.Atoi(strings.TrimPrefix(nodeAttr(n, "id"), "selection_"))
			item := websiteCollection{ID: id, Posters: map[string]string{}}
			for child := range n.Descendants() {
				if nodeClass(child, "kp-poster-title") {
					item.Title = nodeText(child)
				}
				if child.Data == "img" {
					item.Posters["medium"] = categoryPoster(nodeAttr(child, "src"))
				}
				if nodeClass(child, "kp-rating-pill") {
					switch nodeAttr(child, "title") {
					case "Смотрят":
						item.Watchers = nodeText(child)
					case "Фильмов":
						item.Count = nodeText(child)
					case "Просмотров":
						item.Views = nodeText(child)
					}
				}
			}
			if item.ID <= 0 || item.Title == "" {
				return nil, errCategoriesSource
			}
			category.Items = append(category.Items, item)
		}
		if category.ID == "" || category.Title == "" {
			return nil, errCategoriesSource
		}
		categories = append(categories, category)
	}
	if len(categories) == 0 {
		if strings.Contains(body, "login-form") {
			return nil, errCategoriesLogin
		}
		return nil, errCategoriesSource
	}
	return categories, nil
}

func (a *app) serveCategories(w http.ResponseWriter, r *http.Request) {
	categories, err := a.categories.load(r.Context())
	if err != nil {
		fail(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"categories": categories})
}
