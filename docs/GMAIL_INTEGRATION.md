# Gmail OAuth Integration & Draft Automation

`scripts/gmail_draft_tool.py` enables automatic, secure creation of application email drafts directly inside your personal Gmail mailbox (`users.drafts.create`), pre-populated with:
- Recipient email and subject line
- Clean, rich HTML email body with styled paragraphs and clickable links
- Automatic insertion of your personal HTML signature and inline image assets (CID)
- The ATS-tailored CV PDF attached and ready for review

---

## 1. Zero Auto-Send Safety Policy

In alignment with Career-Ops core guidelines, this tool **never automatically sends emails**.  
All created messages land in your **Gmail Drafts (Brouillons)** folder. You retain complete human-in-the-loop oversight to:
1. Review the draft and attached PDF directly in Gmail.
2. Click **Send** manually, or
3. Click the dropdown arrow next to Send and choose **"Schedule send" (Programmer l'envoi)** to deliver the application at the desired business hour.

---

## 2. Setup & Configuration

### Prerequisites
1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (e.g. `Career-Ops`).
2. Enable the **Gmail API** under **APIs & Services**.
3. In **OAuth consent screen**, set user type to **External** and add your personal email to **Test users**.
4. In **Credentials**, create an **OAuth client ID** of type **Desktop app**.
5. Download the client secret JSON file and save it as:
   ```text
   config/gmail_credentials.json
   ```

### First-Time Authentication
Run the one-time interactive OAuth authorization flow:
```bash
python3 scripts/gmail_draft_tool.py --auth-only
```
This starts an ephemeral local callback server, opens your default browser, and prompts you to sign in with your Google account.  
Upon approval, a refresh token is saved securely to `config/gmail_token.json` (strictly git-ignored).

---

## 3. Usage

### Command-Line Arguments
```bash
python3 scripts/gmail_draft_tool.py \
  --to "recruiter@company.com" \
  --subject "Candidature PFE 2026/2027 – Ref XYZ" \
  --body-file "/path/to/body.txt" \
  --attach "output/cv-candidate-report-company-YYYY-MM-DD.pdf"
```

### Signature Synchronization
The tool searches for an existing HTML signature in `config/signature/signature.html` and any inline CID images in `config/signature/*.png`.  
When present, these are bundled into the MIME structure (`multipart/mixed` → `multipart/related` → `multipart/alternative`), ensuring images, badges, and fonts render with 100% fidelity without breaking when opened in Gmail.
