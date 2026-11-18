"""Uploaded images: on disk, or in S3-compatible storage once a bucket is set on the
Configuration page. The choice is made per call, so changing it needs no restart."""

from functools import lru_cache

from django.core.files.storage import FileSystemStorage

from apps.configuration import config


@lru_cache(maxsize=4)
def _s3(bucket, endpoint_url, region, access_key, secret_key, custom_domain):
    from storages.backends.s3 import S3Storage

    return S3Storage(
        bucket_name=bucket, endpoint_url=endpoint_url or None, region_name=region or None,
        access_key=access_key, secret_key=secret_key, custom_domain=custom_domain or None,
        querystring_auth=False,  # images in public descriptions need plain URLs
        file_overwrite=False,
    )


def current():
    bucket = config.get("storage.bucket")
    if not bucket:
        return FileSystemStorage()
    return _s3(
        bucket, config.get("storage.endpoint_url"), config.get("storage.region"),
        config.get("storage.access_key_id"), config.get("storage.secret_access_key"),
        config.get("storage.custom_domain"),
    )


class ConfiguredStorage:
    """Django's default storage: passes every call to the storage configured right now."""

    def __getattr__(self, name):
        return getattr(current(), name)
