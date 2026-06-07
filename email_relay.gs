/**
 * COS Cash-Back Tracker — email relay (Google Apps Script)
 *
 * This tiny script lets the Chrome extension email you a digest from your OWN Gmail,
 * with no server and no API keys. Setup (one time, ~2 minutes):
 *
 *   1. Go to script.google.com  →  New project.
 *   2. Delete the sample, paste THIS whole file.
 *   3. Click Deploy  →  New deployment  →  (gear) Web app.
 *        - Description:        COS tracker relay
 *        - Execute as:         Me
 *        - Who has access:     Anyone
 *   4. Deploy → Authorize access → allow (it only sends mail as you).
 *   5. Copy the Web app URL ending in /exec.
 *   6. Paste that URL into the extension: Settings → Email setup → relay field → Save → Send test email.
 *
 * Privacy: the URL is an unguessable token. Anyone who has it could trigger an email
 * *to the address the extension sends* — keep it private. To rotate it, redeploy.
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (!data.to || !data.subject) {
      return json({ ok: false, error: "missing to/subject" });
    }
    MailApp.sendEmail({
      to: data.to,
      subject: data.subject,
      htmlBody: data.html || "",
      body: data.text || (data.html ? data.html.replace(/<[^>]+>/g, " ") : "(no content)")
    });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return ContentService.createTextOutput("COS Cash-Back Tracker relay is running.");
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
