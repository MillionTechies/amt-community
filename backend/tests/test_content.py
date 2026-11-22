import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.content import richtext
from tests.test_events import create_event


def test_rich_text_keeps_what_the_editor_makes():
    html = (
        '<h2 style="text-align: center">Agenda</h2>'
        '<p><span style="font-size: 20px">Big</span> <strong>bold</strong> <a href="https://x.dev">link</a></p>'
        '<ul><li>One</li></ul><img src="https://cdn.example.com/a.png" alt="A">'
        '<div data-youtube-video=""><iframe src="https://www.youtube-nocookie.com/embed/abc123"></iframe></div>'
    )
    cleaned = richtext.clean(html)
    for kept in (
        '<h2 style="text-align:center">', '<span style="font-size:20px">', "<strong>bold</strong>",
        '<a href="https://x.dev" rel="noopener noreferrer">', "<li>One</li>",
        '<img src="https://cdn.example.com/a.png" alt="A">',
        '<iframe src="https://www.youtube-nocookie.com/embed/abc123">',
    ):
        assert kept in cleaned, kept


@pytest.mark.parametrize(
    "html",
    [
        "<script>alert(1)</script>",
        '<img src="x" onerror="alert(1)">',
        '<a href="javascript:alert(1)">x</a>',
        '<iframe src="https://evil.example.com/embed/x"></iframe>',
        '<iframe src="https://www.youtube.com/watch?v=x"></iframe>',
        '<span style="position: fixed; color: red">x</span>',
        '<img src="data:image/png;base64,AAAA">',
    ],
)
def test_rich_text_removes_anything_dangerous(html):
    cleaned = richtext.clean(html)
    for bad in ("script", "onerror", "javascript:", "evil.example", "watch?v", "position", "data:image"):
        assert bad not in cleaned


def test_plain_text_descriptions_are_left_alone():
    assert richtext.clean("Line one\nLine two & more") == "Line one\nLine two & more"
    assert richtext.to_text("<h2>Title</h2><p>Hello &amp; welcome</p>") == "Title\n\nHello & welcome"


def test_event_descriptions_are_cleaned_when_saved(admin, org):
    event = create_event(admin, org, description='<p>Hi</p><script>x()</script>')
    assert event["description"] == "<p>Hi</p>"


def image(name="photo.png", fmt="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), "green").save(buffer, fmt)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=f"image/{fmt.lower()}")


def test_organisers_upload_images(admin, bob, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    response = admin.post("/api/uploads/", {"file": image()}, format="multipart")
    assert response.status_code == 201, response.content
    assert response.json()["url"].startswith("http://testserver/media/uploads/")
    assert bob.post("/api/uploads/", {"file": image()}, format="multipart").status_code == 403


def test_uploads_must_be_images(admin, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    fake = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
    assert admin.post("/api/uploads/", {"file": fake}, format="multipart").status_code == 400


def test_an_upload_needs_a_file(admin):
    response = admin.post("/api/uploads/", {}, format="multipart")
    assert response.status_code == 400
    assert response.json() == {"file": "Choose an image to upload."}


def test_uploads_are_limited_to_5_mb(admin, monkeypatch):
    monkeypatch.setattr("apps.content.views.MAX_BYTES", 10)
    response = admin.post("/api/uploads/", {"file": image()}, format="multipart")
    assert response.status_code == 400
    assert response.json() == {"file": "Images can be up to 5 MB."}


def test_uploads_must_be_a_web_image_format(admin, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    response = admin.post("/api/uploads/", {"file": image("photo.bmp", "BMP")}, format="multipart")
    assert response.status_code == 400
    assert response.json() == {"file": "Use a JPEG, PNG, WebP or GIF image."}
    assert not list(tmp_path.iterdir())
