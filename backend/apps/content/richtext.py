"""Rich text written by organisers: cleaned to a safe subset of HTML before it is stored.

The editor (Tiptap, in the frontend) produces headings, paragraphs, lists, links, images,
font sizes, alignment and YouTube or Vimeo embeds. Anything else is removed, so a
description can never carry scripts, forms or third-party frames.
"""

from urllib.parse import urlparse

import nh3

TAGS = {
    "p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "code", "pre",
    "blockquote", "ul", "ol", "li", "a", "hr", "img", "span", "div", "iframe",
}
ATTRIBUTES = {
    "a": {"href", "target"},
    "img": {"src", "alt", "title", "width", "height"},
    "span": {"style"},
    "p": {"style"},
    "h2": {"style"},
    "h3": {"style"},
    "h4": {"style"},
    "div": {"data-youtube-video", "data-video"},
    "iframe": {"src", "width", "height", "allowfullscreen", "allow", "frameborder"},
    "ol": {"start"},
}
STYLES = {"font-size", "text-align"}

# Only these sites may be embedded as video.
VIDEO_HOSTS = {
    "www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com",
    "player.vimeo.com",
}


def _keep(tag: str, attribute: str, value: str) -> str | None:
    if tag == "iframe" and attribute == "src":
        url = urlparse(value)
        if url.scheme != "https" or url.hostname not in VIDEO_HOSTS:
            return None
        if url.hostname and "youtube" in url.hostname and not url.path.startswith("/embed/"):
            return None
    if tag == "img" and attribute == "src" and not value.startswith(("https://", "http://", "/")):
        return None  # no data: or javascript: images
    return value


def clean(html: str) -> str:
    """The HTML an organiser typed, reduced to what the editor can make. Plain text passes through."""
    if not html or "<" not in html:
        return html or ""
    cleaned = nh3.clean(
        html,
        tags=TAGS,
        attributes=ATTRIBUTES,
        attribute_filter=_keep,
        filter_style_properties=STYLES,
        url_schemes={"http", "https", "mailto"},
        link_rel="noopener noreferrer",
    )
    # An iframe that lost its src is an empty box; drop it.
    return cleaned.replace("<iframe></iframe>", "")


def to_text(html: str) -> str:
    """Plain text for emails' text part and calendar invites."""
    if not html or "<" not in html:
        return html or ""
    spaced = html.replace("</p>", "</p>\n\n").replace("<br>", "\n").replace("</li>", "</li>\n")
    for level in ("h2", "h3", "h4"):
        spaced = spaced.replace(f"</{level}>", f"</{level}>\n\n")
    text = nh3.clean(spaced, tags=set())
    import html as html_lib

    return "\n".join(line.strip() for line in html_lib.unescape(text).splitlines()).strip()
