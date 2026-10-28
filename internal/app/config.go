package app

import (
	"errors"
	"net/url"
	"strings"
)

type config struct {
	proxy          bool
	token          string
	hosts, origins []string
	base           string
}

func loadConfig(getenv func(string) string) (config, error) {
	c := config{proxy: getenv("ENABLE_PROXY") == "true", token: getenv("PROXY_TOKEN"), base: getenv("PUBLIC_BASE_URL")}
	var err error
	c.hosts, err = parseHosts(getenv("CDN_HOSTS"))
	if err != nil {
		return c, err
	}
	for _, raw := range strings.Split(getenv("ALLOWED_ORIGINS"), ",") {
		origin := strings.TrimSpace(raw)
		if origin == "" {
			continue
		}
		if origin != "null" {
			u, err := url.Parse(origin)
			if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.String() != u.Scheme+"://"+u.Host {
				return c, errors.New("invalid ALLOWED_ORIGINS")
			}
		}
		c.origins = append(c.origins, origin)
	}
	if c.proxy {
		if len(c.token) < 32 || len(c.hosts) == 0 {
			return c, errors.New("proxy requires PROXY_TOKEN of 32+ characters and CDN_HOSTS")
		}
		u, err := url.Parse(c.base)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.String() != "https://"+u.Host {
			return c, errors.New("PUBLIC_BASE_URL must be an HTTPS origin")
		}
	}
	return c, nil
}
