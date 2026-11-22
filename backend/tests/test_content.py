import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from model_bakery import baker
from PIL import Image

from apps.accounts.models import RoleAssignment
from apps.content import richtext
from apps.content.models import Upload
from tests.conftest import sign_in


def test_rich_text_keeps_what_the_editor_makes():
    html = (
        '<h2 style="text-align:center">Agenda</h2>'
        '<p><span style="font-size:20px">Big</span> <strong>bold</strong> '
        '<a href="https://x.dev" rel="noopener noreferrer">link</a></p>'
        '<ul><li>One</li></ul><img src="https://cdn.example.com/a.png" alt="A">'
        '<div data-youtube-video=""><iframe src="https://www.youtube-nocookie.com/embed/abc123"></iframe></div>'
        '<iframe src="https://player.vimeo.com/video/1"></iframe>'
    )
    assert richtext.clean(html) == html


@pytest.mark.parametrize(
    ("html", "cleaned"),
    [
        ("<script>alert(1)</script>", ""),
        ('<img src="x" onerror="alert(1)">', "<img>"),
        ('<img src="data:image/png;base64,AAAA">', "<img>"),
        ('<a href="javascript:alert(1)">x</a>', '<a rel="noopener noreferrer">x</a>'),
        ('<iframe src="https://evil.example.com/embed/x"></iframe>', ""),
        ('<iframe src="https://www.youtube.com/watch?v=x"></iframe>', ""),
        ('<span style="position: fixed; color: red">x</span>', '<span style="">x</span>'),
    ],
)
def test_rich_text_removes_anything_dangerous(html, cleaned):
    assert richtext.clean(html) == cleaned


def test_plain_text_is_left_alone_and_html_reads_as_text():
    assert richtext.clean("Line one\nLine two & more") == "Line one\nLine two & more"
    assert richtext.to_text("Line one & more") == "Line one & more"
    assert richtext.to_text("<h2>Title</h2><p>Hello &amp; welcome</p>") == "Title\n\nHello & welcome"


def image(name="photo.png", fmt="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), "green").save(buffer, fmt)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=f"image/{fmt.lower()}")


@pytest.fixture
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def hackathon_manager(org):
    client = sign_in("hana")
    baker.make(RoleAssignment, profile=client.profile, organization=org, role=RoleAssignment.Role.HACKATHON_MANAGER)
    return client


def test_only_organisers_upload_images(admin, hackathon_manager, bob, media):
    uploads = reverse("uploads")
    assert admin.post(uploads, {"file": image()}, format="multipart").json()["url"].startswith(
        "http://testserver/media/uploads/"
    )
    assert hackathon_manager.post(uploads, {"file": image()}, format="multipart").status_code == 201
    assert bob.post(uploads, {"file": image()}, format="multipart").status_code == 403
    assert Upload.objects.count() == 2


@pytest.mark.parametrize(
    ("payload", "max_bytes", "error"),
    [
        ({}, 5 * 1024 * 1024, "Choose an image to upload."),
        ({"file": image()}, 10, "Images can be up to 5 MB."),
        ({"file": SimpleUploadedFile("x.png", b"not an image")}, 5 * 1024 * 1024, "That file is not an image we can use."),
        ({"file": image("photo.bmp", "BMP")}, 5 * 1024 * 1024, "Use a JPEG, PNG, WebP or GIF image."),
    ],
)
def test_uploads_must_be_small_web_images(admin, media, monkeypatch, payload, max_bytes, error):
    monkeypatch.setattr("apps.content.views.MAX_BYTES", max_bytes)
    response = admin.post(reverse("uploads"), payload, format="multipart")
    assert response.status_code == 400
    assert response.json() == {"file": error}
    assert not list(media.iterdir())
