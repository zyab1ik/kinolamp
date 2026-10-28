package app

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var attrPattern = regexp.MustCompile(`(?:^|,)([A-Z0-9-]+)=(?:"([^"\r\n]*)"|([^,\r\n]*))`)
var resolutionPattern = regexp.MustCompile(`^\d+x(\d+)$`)
var codecsPattern = regexp.MustCompile(`^[a-zA-Z0-9., -]+$`)
var framePattern = regexp.MustCompile(`^\d+(\.\d+)?$`)
var languagePattern = regexp.MustCompile(`^[a-zA-Z-]{2,16}$`)

func attributes(text string) map[string]string {
	result := make(map[string]string)
	for _, match := range attrPattern.FindAllStringSubmatch(text, -1) {
		value := match[2]
		if value == "" {
			value = match[3]
		}
		result[match[1]] = value
	}
	return result
}

type variant struct {
	attrs     map[string]string
	uri       string
	height    int
	bandwidth uint64
}

func reduceMaster(text string, base *url.URL, hosts []string, voice, maxHeight int) (string, error) {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if lines[0] != "#EXTM3U" {
		return "", errors.New("not HLS")
	}
	var audios []map[string]string
	var streams []variant
	independent := false
	for i, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "#EXT-X-INDEPENDENT-SEGMENTS" {
			independent = true
		}
		if attrs, ok := strings.CutPrefix(line, "#EXT-X-MEDIA:"); ok {
			a := attributes(attrs)
			if a["TYPE"] == "AUDIO" {
				audios = append(audios, a)
			}
		}
		if attrs, ok := strings.CutPrefix(line, "#EXT-X-STREAM-INF:"); ok && i+1 < len(lines) {
			a := attributes(attrs)
			uri := strings.TrimSpace(lines[i+1])
			bandwidth, err := strconv.ParseUint(a["BANDWIDTH"], 10, 64)
			if err != nil || bandwidth == 0 || uri == "" || strings.HasPrefix(uri, "#") {
				continue
			}
			height := 0
			if resolution := resolutionPattern.FindStringSubmatch(a["RESOLUTION"]); resolution != nil {
				height, _ = strconv.Atoi(resolution[1])
			}
			streams = append(streams, variant{a, uri, height, bandwidth})
		}
	}
	if len(streams) == 0 {
		return "", errors.New("master playlist required")
	}
	sort.SliceStable(streams, func(i, j int) bool {
		if streams[i].height == streams[j].height {
			return streams[i].bandwidth < streams[j].bandwidth
		}
		return streams[i].height < streams[j].height
	})
	selected := streams[0]
	for _, stream := range streams {
		if stream.height > 0 && stream.height <= maxHeight {
			selected = stream
		}
	}
	absolute := func(raw string) (string, error) {
		ref, err := url.Parse(raw)
		if err != nil {
			return "", err
		}
		u, err := allowedURL(base.ResolveReference(ref).String(), hosts)
		if err != nil {
			return "", err
		}
		return u.String(), nil
	}
	output := []string{"#EXTM3U", "#EXT-X-VERSION:6"}
	if independent {
		output = append(output, "#EXT-X-INDEPENDENT-SEGMENTS")
	}
	attrs := []string{fmt.Sprintf("BANDWIDTH=%d", selected.bandwidth)}
	if resolutionPattern.MatchString(selected.attrs["RESOLUTION"]) {
		attrs = append(attrs, "RESOLUTION="+selected.attrs["RESOLUTION"])
	}
	if codecsPattern.MatchString(selected.attrs["CODECS"]) {
		attrs = append(attrs, `CODECS="`+selected.attrs["CODECS"]+`"`)
	}
	if framePattern.MatchString(selected.attrs["FRAME-RATE"]) {
		attrs = append(attrs, "FRAME-RATE="+selected.attrs["FRAME-RATE"])
	}
	if group := selected.attrs["AUDIO"]; group != "" {
		var entries []map[string]string
		for _, audio := range audios {
			if audio["GROUP-ID"] == group {
				entries = append(entries, audio)
			}
		}
		var pick map[string]string
		for _, entry := range entries {
			if voice == 0 && (pick == nil || entry["DEFAULT"] == "YES") {
				pick = entry
			}
			if voice > 0 && regexp.MustCompile(fmt.Sprintf(`^0*%d[.\s-]`, voice)).MatchString(entry["NAME"]) {
				pick = entry
				break
			}
		}
		if pick == nil && voice > 0 && voice <= len(entries) {
			pick = entries[voice-1]
		}
		if pick == nil || pick["URI"] == "" {
			return "", errors.New("audio track unavailable")
		}
		uri, err := absolute(pick["URI"])
		if err != nil {
			return "", err
		}
		lang := pick["LANGUAGE"]
		if !languagePattern.MatchString(lang) {
			lang = "und"
		}
		output = append(output, `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Selected",LANGUAGE="`+lang+`",DEFAULT=YES,AUTOSELECT=YES,URI="`+uri+`"`)
		attrs = append(attrs, `AUDIO="audio"`)
	}
	uri, err := absolute(selected.uri)
	if err != nil {
		return "", err
	}
	output = append(output, "#EXT-X-STREAM-INF:"+strings.Join(attrs, ","), uri)
	return strings.Join(output, "\n") + "\n", nil
}
