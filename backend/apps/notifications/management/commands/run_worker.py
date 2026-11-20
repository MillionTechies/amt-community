"""Background work: queued emails, retries, event reminders, and keeping the
organization mirror in step with Keycloak.

    python manage.py run_worker          # keep running (a separate process or container)
    python manage.py run_worker --once   # one pass of the email work, for cron
"""

import logging
import time

import httpx
from amt_auth.exceptions import AdminAPIError
from django.core.management.base import BaseCommand

from apps.accounts.sync import locked_sync_all
from apps.notifications import emails, sender

log = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Send queued emails and event reminders, and sync organizations from Keycloak."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Run one pass of the email work and stop.")
        parser.add_argument("--interval", type=int, default=30, help="Seconds between passes.")
        parser.add_argument(
            "--sync-interval", type=int, default=900,
            help="Seconds between full organization syncs from Keycloak (0 turns them off). "
            "New organizations also arrive with the first request that names them.",
        )

    def handle(self, *args, once=False, interval=30, sync_interval=900, **options):
        next_sync = time.monotonic()
        while True:
            sender.release_stuck()
            reminders = emails.queue_reminders()
            sent = sender.send_queued()
            if reminders or sent:
                self.stdout.write(f"Queued {reminders} reminders, sent {sent} emails.")
            if once:
                return
            if sync_interval > 0 and time.monotonic() >= next_sync:
                self._sync()
                next_sync = time.monotonic() + sync_interval
            time.sleep(interval)

    def _sync(self) -> None:
        try:
            count = locked_sync_all()
        except (AdminAPIError, httpx.HTTPError):
            log.warning("Organization sync from Keycloak failed; will try again", exc_info=True)
            return
        if count is None:
            self.stdout.write("Organization sync skipped: another sync is running.")
