"""Send emails in the background: queued emails, retries and event reminders.

    python manage.py run_worker          # keep running (a separate process or container)
    python manage.py run_worker --once   # one pass, for cron
"""

import time

from django.core.management.base import BaseCommand

from apps.notifications import emails, sender


class Command(BaseCommand):
    help = "Send queued emails and event reminders."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Run one pass and stop.")
        parser.add_argument("--interval", type=int, default=30, help="Seconds between passes.")

    def handle(self, *args, once=False, interval=30, **options):
        while True:
            sender.release_stuck()
            reminders = emails.queue_reminders()
            sent = sender.send_queued()
            if reminders or sent:
                self.stdout.write(f"Queued {reminders} reminders, sent {sent} emails.")
            if once:
                return
            time.sleep(interval)
