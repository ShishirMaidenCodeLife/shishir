// This Worker does two jobs:
// 1. For POST /api/contact, it handles the contact form and emails you.
// 2. For every other request, it just serves the static site files
//    (index.html, etc.) via the ASSETS binding.
//
// Required environment variables (set in Cloudflare dashboard:
// your Worker > Settings > Variables and Secrets):
//   CF_ACCOUNT_ID       - your Cloudflare account ID
//   CF_EMAIL_API_TOKEN  - API token with "Email Sending: Edit" permission
//   CONTACT_TO_EMAIL    - where messages should land
//   CONTACT_FROM_EMAIL  - a verified sending address on your onboarded domain

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/contact" && request.method === "POST") {
      return handleContact(request, env);
    }

    // Everything else: serve the static site as-is.
    return env.ASSETS.fetch(request);
  },
};

async function handleContact(request, env) {
  try {
    let name, email, message, company;

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json();
      name = body.name;
      email = body.email;
      message = body.message;
      company = body.company;
    } else {
      const form = await request.formData();
      name = form.get("name");
      email = form.get("email");
      message = form.get("message");
      company = form.get("company");
    }

    // Honeypot: real visitors never fill this hidden field.
    if (company) {
      return json({ success: true });
    }

    name = (name || "").toString().trim();
    email = (email || "").toString().trim();
    message = (message || "").toString().trim();

    if (!name || !email || !message) {
      return json({ success: false, error: "Please fill in every field." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, error: "Please enter a valid email address." }, 400);
    }
    if (message.length > 5000) {
      return json({ success: false, error: "Message is too long." }, 400);
    }

    const accountId = env.CF_ACCOUNT_ID;
    const apiToken = env.CF_EMAIL_API_TOKEN;
    const toAddress = env.CONTACT_TO_EMAIL;
    const fromAddress = env.CONTACT_FROM_EMAIL;

    if (!accountId || !apiToken || !toAddress || !fromAddress) {
      return json({ success: false, error: "Contact form isn't configured yet." }, 500);
    }

    const text =
      `New message from your portfolio site\n\n` +
      `Name: ${name}\n` +
      `Email: ${email}\n\n` +
      `Message:\n${message}\n`;

    const html =
      `<p><strong>New message from your portfolio site</strong></p>` +
      `<p><strong>Name:</strong> ${escapeHtml(name)}<br>` +
      `<strong>Email:</strong> ${escapeHtml(email)}</p>` +
      `<p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`;

    const cfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: toAddress,
          from: fromAddress,
          subject: `Portfolio contact: ${name}`,
          text,
          html,
        }),
      }
    );

    const cfData = await cfResponse.json().catch(() => ({}));

    if (!cfResponse.ok || cfData.success === false) {
      return json(
        { success: false, error: "Couldn't send your message right now. Please email directly instead." },
        502
      );
    }

    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: "Something went wrong." }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
