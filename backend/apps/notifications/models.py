from django.db import models


class OutboundEmail(models.Model):
    """One email to one person, queued, then sent by `sender.send_queued`.

    Keeping them here means a slow or failing mail server never slows a request, failed
    sends are retried, and `key` stops the same reminder going out twice.
    """

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SENDING = "sending", "Sending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"

    kind = models.CharField(max_length=40)
    key = models.CharField(max_length=200, unique=True, null=True, blank=True)
    to = models.EmailField()
    subject = models.CharField(max_length=300)
    text = models.TextField()
    html = models.TextField()
    # An invite to attach: the .ics content and its METHOD (REQUEST or CANCEL).
    calendar = models.TextField(blank=True)
    calendar_method = models.CharField(max_length=10, blank=True)
    # The ticket QR code to show inline, if any.
    ticket_code = models.CharField(max_length=64, blank=True)
    event = models.ForeignKey(
        "events.Event", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.QUEUED)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["status", "created_at"])]

    def __str__(self) -> str:
        return f"{self.kind} to {self.to}"
