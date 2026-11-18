"""Run slow work (calls to Google, Microsoft or Zoom) after the request, off the request thread."""

import logging
import threading

from django.conf import settings
from django.db import close_old_connections, transaction

log = logging.getLogger(__name__)


def run_later(fn, *args) -> None:
    def run():
        try:
            fn(*args)
        except Exception:
            log.exception("Background task %s failed", getattr(fn, "__name__", fn))

    def on_thread():
        try:
            run()
        finally:
            close_old_connections()  # the thread's own connection

    if getattr(settings, "BACKGROUND_TASKS", "thread") == "inline":
        run()
    else:
        transaction.on_commit(lambda: threading.Thread(target=on_thread, daemon=True).start())
