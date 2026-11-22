#!/usr/bin/env python3
"""
Gmail Draft Tool for Career-Ops
Creates authentic, ready-to-review drafts with PDF attachments and full rich HTML signatures in Gmail using OAuth 2.0.
"""

import os
import sys
import json
import base64
import html
import re
from pathlib import Path
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from email.mime.application import MIMEApplication

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = [
    'https://www.googleapis.com/auth/gmail.compose'
]

ROOT_DIR = Path(__file__).resolve().parent.parent
CREDENTIALS_FILE = ROOT_DIR / 'config' / 'gmail_credentials.json'
TOKEN_FILE = ROOT_DIR / 'config' / 'gmail_token.json'
SIG_DIR = ROOT_DIR / 'config' / 'signature'
SIG_HTML_FILE = SIG_DIR / 'signature.html'


def get_gmail_service():
    """Authenticate and return the Gmail API service instance."""
    if not CREDENTIALS_FILE.exists():
        print(f"❌ Error: Credentials file not found at: {CREDENTIALS_FILE}", file=sys.stderr)
        print("Please place your downloaded OAuth client JSON file at config/gmail_credentials.json", file=sys.stderr)
        sys.exit(1)

    creds = None
    if TOKEN_FILE.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
        except Exception as e:
            print(f"⚠️ Warning: Failed to load existing token ({e}), re-authenticating...", file=sys.stderr)
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print("🔄 Refreshing expired Gmail OAuth access token...")
            creds.refresh(Request())
        else:
            print("🌐 Starting Gmail OAuth authorization flow in your browser...")
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())
        print(f"✅ Token saved successfully to: {TOKEN_FILE}")

    return build('gmail', 'v1', credentials=creds)


def text_to_clean_html(text):
    """Convert plain text email body to clean, rich HTML and append user's signature."""
    # Strip manual signature if it exists
    text = re.sub(
        r'\n*(?:Imed Eddine Amara\s*\n+)?(?:Élève Ingénieur[^\n]*\n+)?(?:Tél\s*:[^\n]*\n+)?(?:Email\s*:[^\n]*)',
        '',
        text,
        flags=re.IGNORECASE
    ).strip()

    paragraphs = text.split('\n\n')
    html_paragraphs = []
    
    for p in paragraphs:
        lines = p.split('\n')
        escaped_lines = []
        for line in lines:
            line_esc = html.escape(line)
            # Make URLs clickable
            line_esc = re.sub(r'(https?://[^\s<>]+)', r'<a href="\1" style="color: #1a73e8; text-decoration: underline;">\1</a>', line_esc)
            escaped_lines.append(line_esc)
        p_html = '<br>'.join(escaped_lines)
        html_paragraphs.append(f'<p style="margin: 0 0 16px 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #202124;">{p_html}</p>')

    signature_html = ""
    if SIG_HTML_FILE.exists():
        with open(SIG_HTML_FILE, 'r', encoding='utf-8') as f:
            signature_html = f.read()

    full_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
</head>
<body style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #202124;">
{''.join(html_paragraphs)}
<div><br clear="all"></div>
{signature_html}
</body>
</html>"""
    return full_html, text


def create_draft(to_email, subject, body_text, attachment_paths=None):
    """
    Create a rich HTML draft in Gmail with signature and attachments.
    """
    service = get_gmail_service()
    
    html_content, clean_plain_text = text_to_clean_html(body_text)

    # Root container: multipart/mixed
    msg_root = MIMEMultipart('mixed')
    msg_root['To'] = to_email
    msg_root['Subject'] = subject

    # Related container for HTML and inline images
    msg_related = MIMEMultipart('related')
    
    # Alternative container for plain text and HTML
    msg_alternative = MIMEMultipart('alternative')
    msg_alternative.attach(MIMEText(clean_plain_text, 'plain', 'utf-8'))
    msg_alternative.attach(MIMEText(html_content, 'html', 'utf-8'))
    msg_related.attach(msg_alternative)

    # Attach signature inline CID images if any
    if SIG_DIR.exists():
        for img_file in SIG_DIR.glob('*.png'):
            cid = img_file.stem
            with open(img_file, 'rb') as fp:
                img_data = fp.read()
                img = MIMEImage(img_data, 'png')
                img.add_header('Content-ID', f'<{cid}>')
                img.add_header('Content-Disposition', 'inline')
                msg_related.attach(img)
                print(f"🖼️ Attached signature image: {cid}")

    msg_root.attach(msg_related)

    # Attach document attachments (e.g. CV PDF)
    if attachment_paths:
        for file_path in attachment_paths:
            path_obj = Path(file_path).resolve()
            if not path_obj.exists():
                print(f"⚠️ Warning: Attachment not found: {path_obj}", file=sys.stderr)
                continue
            
            with open(path_obj, 'rb') as fp:
                file_data = fp.read()
                part = MIMEApplication(file_data, 'pdf')
                part.add_header('Content-Disposition', 'attachment', filename=path_obj.name)
                msg_root.attach(part)
            print(f"📎 Attached document: {path_obj.name} ({len(file_data) // 1024} KB)")

    raw_message = base64.urlsafe_b64encode(msg_root.as_bytes()).decode('utf-8')
    draft_body = {
        'message': {
            'raw': raw_message
        }
    }

    draft = service.users().drafts().create(userId='me', body=draft_body).execute()
    draft_id = draft.get('id')
    print(f"✅ Draft created with full signature & attachments! Draft ID: {draft_id}")
    return draft


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Career-Ops Gmail Draft Tool")
    parser.add_argument("--auth-only", action="store_true", help="Run OAuth flow and exit")
    parser.add_argument("--to", help="Recipient email address")
    parser.add_argument("--subject", help="Email subject line")
    parser.add_argument("--body-file", help="Path to text file containing the body")
    parser.add_argument("--body", help="Inline body text")
    parser.add_argument("--attach", nargs="*", help="File path(s) to attach")
    
    args = parser.parse_args()

    if args.auth_only:
        get_gmail_service()
        print("🎉 Authentication successful! Gmail Draft tool is ready to use.")
        return

    if not args.to or not args.subject:
        parser.print_help()
        sys.exit(1)

    body = ""
    if args.body_file:
        with open(args.body_file, 'r', encoding='utf-8') as f:
            body = f.read()
    elif args.body:
        body = args.body
    else:
        print("❌ Error: You must provide either --body or --body-file", file=sys.stderr)
        sys.exit(1)

    create_draft(args.to, args.subject, body, args.attach)


if __name__ == '__main__':
    main()
