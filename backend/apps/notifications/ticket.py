"""The PDF ticket: attached to the confirmation email, and downloadable from the event page.

Laid out like a printed ticket: a green "This is your ticket" band, the event on the left
(who, what, where, when, issued to, order number, ticket type) and the QR code on the right.
"""

import io
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

GREEN = HexColor("#16a34a")
INK = HexColor("#0c1410")
MUTED = HexColor("#57534e")
PANEL = HexColor("#f4f4f3")
LINE = HexColor("#78716c")
LOCAL = ZoneInfo(settings.TIME_ZONE)


def when_line(event) -> str:
    """NOV 21, 2026, 5:00 PM (EAT)"""
    start = event.starts_at.astimezone(LOCAL)
    return f"{start:%b %-d, %Y, %-I:%M %p} ({start.tzname()})".upper()


def where_line(event) -> str:
    if event.delivery_mode == "online":
        return "Online"
    return event.venue or "Venue to be confirmed"


def build(registration) -> bytes:
    event = registration.event
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    pdf.setTitle(f"Ticket {registration.order_number}: {event.title}")
    pdf.setAuthor("A Million Techies Community")
    page_w, page_h = A4

    left, width = 18 * mm, page_w - 36 * mm
    band_h, body_h = 18 * mm, 84 * mm
    top = page_h - 18 * mm
    body_top = top - band_h
    bottom = body_top - body_h

    # Green band.
    pdf.setFillColor(GREEN)
    pdf.rect(left, body_top, width, band_h, stroke=0, fill=1)
    pdf.setFillColor(white)
    pdf.setFont("Helvetica-Bold", 17)
    pdf.drawString(left + 6 * mm, body_top + 6.3 * mm, "This is your ticket")
    pdf.setFont("Courier-Bold", 11)
    pdf.drawRightString(left + width - 6 * mm, body_top + 6.8 * mm, "A MILLION TECHIES COMMUNITY_")

    # Body panel and its outline.
    pdf.setFillColor(PANEL)
    pdf.rect(left, bottom, width, body_h, stroke=0, fill=1)
    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.8)
    pdf.rect(left, bottom, width, body_h + band_h, stroke=1, fill=0)

    # QR code on a white square, right.
    qr_box = 66 * mm
    qr_x, qr_y = left + width - qr_box - 5 * mm, bottom + (body_h - qr_box) / 2
    pdf.setFillColor(white)
    pdf.rect(qr_x, qr_y, qr_box, qr_box, stroke=0, fill=1)
    widget = QrCodeWidget(str(registration.ticket_code), barLevel="M")
    x1, y1, x2, y2 = widget.getBounds()
    size = qr_box - 10 * mm
    drawing = Drawing(size, size, transform=[size / (x2 - x1), 0, 0, size / (y2 - y1), 0, 0])
    drawing.add(widget)
    renderPDF.draw(drawing, pdf, qr_x + 5 * mm, qr_y + 5 * mm)

    # Event details, left.
    text_x = left + 6 * mm
    text_w = qr_x - text_x - 6 * mm
    y = body_top - 9 * mm
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica", 10)
    pdf.drawString(text_x, y, event.organization.name)
    y -= 8 * mm
    pdf.setFont("Helvetica-Bold", 16)
    for line in simpleSplit(event.title, "Helvetica-Bold", 16, text_w)[:3]:
        pdf.drawString(text_x, y, line)
        y -= 7 * mm
    y -= 4 * mm
    pdf.setFont("Helvetica", 10)
    for line in simpleSplit(where_line(event), "Helvetica", 10, text_w)[:2]:
        pdf.drawString(text_x, y, line)
        y -= 5 * mm
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(text_x, y, when_line(event))

    # Three columns: issued to, order number, ticket.
    col_y = bottom + 24 * mm
    registered = registration.created_at.astimezone(LOCAL)
    status = "Registered" if registration.status == "registered" else registration.get_status_display()
    columns = [
        ("ISSUED TO", [registration.profile.full_name or registration.profile.email]),
        ("ORDER NUMBER", [registration.order_number, status, f"{registered:%b %-d, %Y}".upper()]),
        ("TICKET", ["General admission", "FREE"]),
    ]
    shares = (0.3, 0.38, 0.32)  # the order number needs the most room
    for index, (heading, lines) in enumerate(columns):
        x = text_x + sum(shares[:index]) * text_w
        col_w = shares[index] * text_w
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(x, col_y, heading)
        pdf.setFont("Helvetica", 9)
        line_y = col_y - 5 * mm
        for value in lines:
            for part in simpleSplit(value, "Helvetica", 9, col_w - 3 * mm)[:2]:
                pdf.drawString(x, line_y, part)
                line_y -= 4.5 * mm

    # Footer.
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 8.5)
    pdf.drawCentredString(
        page_w / 2, bottom - 7 * mm,
        f"© {timezone.now():%Y} A Million Techies Community. Learn. Build. Grow.  {settings.COMMUNITY_URL}/events/{event.slug}",
    )
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def filename(registration) -> str:
    return f"{registration.order_number}.pdf"
