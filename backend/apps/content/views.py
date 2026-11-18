from PIL import Image
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import access
from apps.accounts.models import RoleAssignment
from apps.content.models import Upload

MAX_BYTES = 5 * 1024 * 1024
FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}


def manages_anything(request) -> bool:
    if access.is_platform_admin(request) or access.admin_org_ids(request):
        return True
    profile = access.profile_of(request)
    return profile is not None and RoleAssignment.objects.filter(profile=profile).exists()


class UploadView(APIView):
    """POST an image (field `file`); get back the address to put in the editor."""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        if not manages_anything(request):
            raise PermissionDenied("Only organisers can upload images.")
        file = request.FILES.get("file")
        if file is None:
            raise ValidationError({"file": "Choose an image to upload."})
        if file.size > MAX_BYTES:
            raise ValidationError({"file": "Images can be up to 5 MB."})
        try:
            with Image.open(file) as image:
                image.verify()
                kind = image.format
        except Exception:
            raise ValidationError({"file": "That file is not an image we can use."}) from None
        if kind not in FORMATS:
            raise ValidationError({"file": "Use a JPEG, PNG, WebP or GIF image."})
        file.seek(0)
        upload = Upload.objects.create(file=file, uploaded_by=access.profile_of(request))
        return Response(
            {"url": request.build_absolute_uri(upload.file.url)}, status=status.HTTP_201_CREATED
        )
