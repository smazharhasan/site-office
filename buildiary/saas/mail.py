"""Emails from the console to customers, in their own language (English, Urdu or Arabic), in one
Buildiary layout: the sign-up code, the welcome letter, trial follow-ups, payment acknowledgements
and confirmations, and thanks for feedback. Also writes the outgoing mail settings for every site.

The words are in mail_words.py. Every email is sent from the address in Buildiary Cloud Settings
(Outgoing email); customers' replies come back to that address."""

import os

import frappe
from frappe.utils import add_days, cint, date_diff, escape_html, flt, getdate, nowdate

from buildiary.saas.common import ENTITIES, bank_accounts, entity, is_control, plan_price, price_in, settings
from buildiary.saas.mail_words import PEOPLE, W

LANGS = ("en", "ur", "ar")
NAVY, AMBER, INK, MUTED, LINE, SKY = "#0F2238", "#F2B01E", "#14202B", "#5B6875", "#DCE2E8", "#EEF3F9"
ANDROID = "https://buildiary.app/android"


# ---------------------------------------------------------------- settings → every site
MAIL_KEYS = ("mail_server", "mail_port", "use_tls", "use_ssl", "mail_login", "mail_password", "auto_email_id", "email_sender_name",
	"disable_mail_smtp_authentication", "always_use_account_email_id_as_sender")


def apply_config(s=None):
	"""Writes the console's outgoing mail settings into common_site_config.json, so the console and
	every workspace send through the same server and address."""
	from frappe.installer import update_site_config

	s = s or settings()
	path = os.path.join(frappe.local.sites_path, "common_site_config.json")
	if not os.path.exists(path):
		return
	if not (cint(s.get("mail_enabled")) and s.get("mail_server") and s.get("mail_from")):
		for k in MAIL_KEYS:
			update_site_config(k, "None", validate=False, site_config_path=path)
		_reload_conf()
		return
	login = (s.get("mail_login") or "").strip()
	password = s.get_password("mail_password", raise_exception=False) if login else None
	values = {
		"mail_server": s.mail_server.strip(), "mail_port": cint(s.mail_port) or 587, "use_tls": 1 if cint(s.mail_use_tls) else 0, "use_ssl": 0,
		"auto_email_id": s.mail_from.strip(), "email_sender_name": (s.mail_sender_name or "Buildiary").strip(),
		"mail_login": login or "None", "mail_password": password or "None",
		"disable_mail_smtp_authentication": 0 if login else 1, "always_use_account_email_id_as_sender": 1,
	}
	for k, v in values.items():
		update_site_config(k, v, validate=False, site_config_path=path)
	_reload_conf()


def _reload_conf():
	"""update_site_config leaves "None" in this request's settings for removed keys: read them again."""
	from frappe.config import get_site_config

	frappe.local.conf = frappe._dict(get_site_config())
	frappe.local.outgoing_email_account = {}


def _s():
	"""Buildiary Cloud Settings on the console; on a customer's workspace (password emails), what its site_config says."""
	if is_control():
		return settings()
	m = frappe.conf.get("buildiary") or {}
	console = m.get("console") or ""
	base = console.split(".", 1)[1] if console.count(".") >= 2 else ""
	return frappe._dict(control_host=console, base_domain=base, website_url=f"https://{base}" if base else "", privacy_url=None, terms_url=None,
		support_email=m.get("support_email"), support_whatsapp=m.get("support_whatsapp"), grace_days=m.get("grace_days"),
		mail_from=frappe.conf.get("auto_email_id"), mail_sender_name=frappe.conf.get("email_sender_name") or "Buildiary")


# ---------------------------------------------------------------- small pieces
def lang_of(t):
	lang = t.get("language") if t else None
	return lang if lang in LANGS else "en"


def w(lang, key, **kw):
	v = W[lang].get(key, W["en"].get(key, key))
	return v.format(**kw) if kw and isinstance(v, str) else v


def esc(v):
	"""Text from people (names, messages), safe in the email and in its template."""
	return escape_html(str(v or "")).replace("{", "&#123;").replace("}", "&#125;")


def date_text(d, lang="en"):
	if not d:
		return ""
	d = getdate(d)
	return f"{d.day} {W[lang]['months'][d.month - 1]} {d.year}"


def money(amount, currency):
	n = flt(amount)
	text = f"{n:,.0f}" if n == int(n) else f"{n:,.2f}"
	return f"${text}" if currency == "USD" else f"{currency} {text}"


def ltr(text):
	"""Numbers, addresses and codes stay left to right inside Urdu and Arabic text."""
	return f'<span dir="ltr" style="unicode-bidi:isolate">{text}</span>'


def whatsapp(number):
	"""The support WhatsApp number written the international way, linked to a chat."""
	import re

	digits = re.sub(r"\D", "", str(number or ""))
	if not digits:
		return ""
	shown = "+" + digits
	try:
		import phonenumbers

		shown = phonenumbers.format_number(phonenumbers.parse("+" + digits), phonenumbers.PhoneNumberFormat.INTERNATIONAL)
	except Exception:
		pass
	return ltr(f'<a href="https://wa.me/{digits}" style="color:{MUTED}">{esc(shown)}</a>')


def period_text(periods, billing_period, lang):
	n = max(1, cint(periods) or 1)
	if billing_period == "Yearly":
		if lang == "ar":
			return "سنة واحدة" if n == 1 else "سنتان" if n == 2 else f"{n} سنوات" if n <= 10 else f"{n} سنة"
		return w(lang, "year1") if n == 1 else w(lang, "yearN", n=n)
	if lang == "ar":
		return "شهر واحد" if n == 1 else "شهران" if n == 2 else f"{n} أشهر" if n <= 10 else f"{n} شهراً"
	return w(lang, "month1") if n == 1 else w(lang, "monthN", n=n)


def person(text, lang):
	return PEOPLE.get((text or "").strip(), {}).get(lang) or (text or "")


def plan_label(plan_name, lang):
	mode = frappe.db.get_value("Buildiary Plan", plan_name, "mode") if plan_name else None
	return W[lang]["plans"].get(mode or plan_name, plan_name or "")


def urls(t=None, lang="en"):
	s = _s()
	console = f"https://{s.control_host}" if s.control_host else ""
	site = (s.website_url or (f"https://{s.base_domain}" if s.base_domain else "")).rstrip("/")
	feedback = f"{console}/feedback?lang={lang}"
	if t:
		from buildiary.www.feedback import link_key

		feedback += f"&w={t.name}&k={link_key(t.name)}"
	return {
		"console": console, "site": site, "feedback": feedback,
		"ws": f"https://{t.site_host}" if t and t.site_host else "", "billing": f"https://{t.site_host}/billing" if t and t.site_host else "",
		"privacy": s.privacy_url or (f"{site}/privacy/" if site else ""), "terms": s.terms_url or (f"{site}/terms/" if site else ""),
	}


# ---------------------------------------------------------------- the layout
def _font(lang):
	if lang == "ur":
		return "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Urdu Typesetting',Tahoma,Arial,sans-serif", "2"
	if lang == "ar":
		return "'Segoe UI',Tahoma,'Geeza Pro',Arial,sans-serif", "1.75"
	return "'Segoe UI',Roboto,Helvetica,Arial,sans-serif", "1.6"


def h(text, lang):
	font, _lh = _font(lang)
	return f'<h2 style="margin:28px 0 10px;font:700 19px/1.4 {font};color:{NAVY}">{text}</h2>'


def p(text, lang, color=INK, size=16):
	font, lh = _font(lang)
	return f'<p style="margin:0 0 14px;font:400 {size}px/{lh} {font};color:{color}">{text}</p>'


def button(url, label, lang):
	font, _lh = _font(lang)
	return (f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px"><tr><td style="border-radius:999px;background:{AMBER}">'
		f'<a href="{url}" style="display:inline-block;padding:13px 26px;font:700 16px/1.2 {font};color:#1B1405;text-decoration:none;border-radius:999px">{label}</a>'
		f"</td></tr></table>")


def rows(pairs, lang, start):
	"""A small two-column table (label, value)."""
	font, _lh = _font(lang)
	out = "".join(
		f'<tr><td style="padding:9px 12px;border-bottom:1px solid {LINE};font:400 14px/1.6 {font};color:{MUTED};text-align:{start};vertical-align:top;width:38%">{k}</td>'
		f'<td style="padding:9px 12px;border-bottom:1px solid {LINE};font:600 15px/1.6 {font};color:{INK};text-align:{start};vertical-align:top">{v}</td></tr>'
		for k, v in pairs if v)
	return f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid {LINE};border-radius:12px;border-collapse:separate;margin:6px 0 16px;background:#fff">{out}</table>'


def numbered(items, lang, start):
	"""Numbered steps: (title, text) pairs or plain strings."""
	font, lh = _font(lang)
	out = ""
	for i, it in enumerate(items, 1):
		title, text = it if isinstance(it, tuple) else ("", it)
		body = (f'<b style="color:{NAVY}">{title}</b><br>' if title else "") + text
		out += (f'<tr><td style="width:34px;vertical-align:top;padding:4px 0"><div style="width:26px;height:26px;border-radius:13px;background:{AMBER};color:#1B1405;'
			f'font:700 14px/26px Arial,sans-serif;text-align:center">{i}</div></td>'
			f'<td style="padding:4px 0 12px;font:400 15px/{lh} {font};color:{INK};text-align:{start}">{body}</td></tr>')
	return f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 8px">{out}</table>'


def bullets(items, lang, start):
	"""(title, text) pairs with an amber tick."""
	font, lh = _font(lang)
	out = "".join(
		f'<tr><td style="width:24px;vertical-align:top;padding:7px 0;color:{AMBER};font:700 16px/1.4 Arial,sans-serif">&#10003;</td>'
		f'<td style="padding:5px 0 9px;font:400 15px/{lh} {font};color:{INK};text-align:{start}"><b style="color:{NAVY}">{title}</b> &ndash; {text}</td></tr>'
		for title, text in items)
	return f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:2px 0 10px">{out}</table>'


def box(inner, bg=SKY):
	return f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 18px"><tr><td style="background:{bg};border-radius:14px;padding:18px 20px">{inner}</td></tr></table>'


def layout(lang, title, body, preheader="", to="", why="foot_why"):
	"""The whole email: logo, title, body, and the footer with the companies and links."""
	rtl = lang in ("ur", "ar")
	start = "right" if rtl else "left"
	font, lh = _font(lang)
	s = _s()
	u = urls(None, lang)
	logo = f'{u["console"]}/assets/buildiary/images/email-logo.png' if u["console"] else ""
	ents = "".join(
		f'<div style="margin:2px 0">{esc(e.get(lang) or e["en"])} &middot; {esc(e["place"].get(lang) or e["place"]["en"])}</div>' for e in ENTITIES.values())
	wa = w(lang, "foot_wa", n=whatsapp(s.support_whatsapp)) if s.support_whatsapp else ""
	links = " &nbsp;&middot;&nbsp; ".join(
		f'<a href="{url}" style="color:{MUTED};text-decoration:underline">{w(lang, k)}</a>'
		for k, url in (("l_site", u["site"]), ("l_feedback", u["feedback"]), ("l_privacy", u["privacy"]), ("l_terms", u["terms"])) if url)
	why = w(lang, why, email=ltr(esc(to))) if to else ""
	pre = f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">{esc(preheader)}</div>' if preheader else ""
	html = f"""<!DOCTYPE html>
<html lang="{lang}" dir="{'rtl' if rtl else 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>{esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F2F5F8">{pre}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F2F5F8" dir="{'rtl' if rtl else 'ltr'}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid {LINE}">
<tr><td style="padding:22px 28px 18px;text-align:{start};border-bottom:3px solid {AMBER}">{f'<img src="{logo}" width="165" height="40" alt="Buildiary" style="display:inline-block;border:0;height:40px;width:165px">' if logo else f'<b style="font:800 24px Arial;color:{NAVY}">buildiary</b>'}</td></tr>
<tr><td style="padding:26px 28px 8px;text-align:{start}" dir="{'rtl' if rtl else 'ltr'}">
<h1 style="margin:0 0 16px;font:800 24px/1.35 {font};color:{NAVY}">{title}</h1>
{body}
</td></tr>
<tr><td style="padding:18px 28px 24px;background:#F7F9FB;border-top:1px solid {LINE};text-align:{start};font:400 12.5px/{lh} {font};color:{MUTED}" dir="{'rtl' if rtl else 'ltr'}">
<div style="margin:0 0 8px">{w(lang, 'foot_help', wa=wa)}</div>
<div style="margin:0 0 6px;color:{INK};font-weight:600">{w(lang, 'foot_product')}</div>
{ents}
<div style="margin:12px 0 6px">{links}</div>
<div style="margin:6px 0 0">{why}</div>
</td></tr></table>
</td></tr></table></body></html>"""
	# the email is passed through a template engine on the way out: no template marks may remain
	return html.replace("{{", "&#123;&#123;").replace("{%", "&#123;%").replace("{#", "&#123;#")


# ---------------------------------------------------------------- sending
def _sender(name=None):
	s = _s()
	addr = (s.get("mail_from") or frappe.conf.get("auto_email_id") or "").strip()
	if not addr:
		return None
	name = (name or s.get("mail_sender_name") or "Buildiary").replace('"', "").replace("<", "").replace(">", "")
	return f'"{name}" <{addr}>'


def deliver(to, subject, html, sender_name=None, now=False, ref=None, soon=False):
	"""Queues (or sends now) one email; False when it could not be. soon: queued, then sent by a
	background job straight away (a mail server problem can't then break the person's request)."""
	if not to:
		return False
	try:
		q = frappe.sendmail(recipients=[to], sender=_sender(sender_name), subject=subject, message=html, raw_html=True, add_css=False,
			add_unsubscribe_link=0, delayed=not now, now=now, reply_to=(_s().get("mail_from") or None),
			reference_doctype=ref.doctype if ref else None, reference_name=ref.name if ref else None)
		if soon and not now:
			send_soon(q)
		return True
	except Exception:
		frappe.log_error(f"Buildiary: could not send the email '{subject}' to {to}")
		return False


def send_soon(q):
	"""A queued email goes out within seconds (a background job) instead of at the next scheduler run."""
	name = getattr(q, "name", None) if q else None
	if name and not frappe.in_test:
		frappe.enqueue("buildiary.saas.mail.send_queued", name=name, queue="short", enqueue_after_commit=True)


def send_queued(name):
	"""The background job: one queued email, sent now (a failure stays in the queue for the scheduler to retry)."""
	from frappe.email.doctype.email_queue.email_queue import EmailQueue

	q = EmailQueue.find(name)
	if q and q.status == "Not Sent":
		q.send()


# ---------------------------------------------------------------- payment details
def plans_block(t, lang, start):
	out = []
	for pl in frappe.get_all("Buildiary Plan", filters={"is_active": 1}, fields=["*"], order_by="sort_order asc"):
		m, y = plan_price(pl, "Monthly", t.country), plan_price(pl, "Yearly", t.country)
		out.append(w(lang, "plan_line", plan=esc(W[lang]["plans"].get(pl.mode, pl.name)), m=ltr(money(m["amount"], m["currency"])),
			y=ltr(money(y["amount"], y["currency"])), free=w(lang, "two_free")))
	font, lh = _font(lang)
	return "".join(f'<p style="margin:0 0 8px;font:400 15px/{lh} {font};color:{INK}">&#9679;&nbsp; {x}</p>' for x in out)


def bank_block(t, lang, start):
	"""Where and how to pay, for this customer's country, with their plan's amount in each account's currency."""
	accounts = bank_accounts(t.country)
	plan = t.plan if t.plan and frappe.db.exists("Buildiary Plan", t.plan) else None
	body = p(w(lang, "pay_intro", entity=esc(entity(t.country, lang)), ref=ltr(esc(t.name))), lang)
	if not accounts:
		return h(w(lang, "pay_title"), lang) + body + p(w(lang, "no_bank"), lang)
	for a in accounts:
		amount = ""
		if plan:
			amount = w(lang, "amount_line", m=ltr(money(price_in(plan, "Monthly", a.currency), a.currency)), y=ltr(money(price_in(plan, "Yearly", a.currency), a.currency)))
		body += rows([
			(w(lang, "k_bank"), esc(a.bank_name)), (w(lang, "k_title"), esc(a.account_title)), (w(lang, "k_iban"), a.iban and ltr(esc(a.iban))),
			(w(lang, "k_no"), a.account_number and ltr(esc(a.account_number))), (w(lang, "k_swift"), a.swift and ltr(esc(a.swift))), (w(lang, "k_branch"), esc(a.branch)),
			(w(lang, "k_currency"), a.currency and ltr(esc(a.currency))), (w(lang, "k_amount") + (f" ({esc(plan_label(plan, lang))})" if plan else ""), amount),
		], lang, start)
	body += numbered(W[lang]["pay_steps"], lang, start)
	return h(w(lang, "pay_title"), lang) + body


def _greeting(t, lang):
	out = p(w(lang, "hello", name=esc(t.contact_name)), lang)
	if W[lang].get("salam"):
		out += p(W[lang]["salam"], lang)
	return out


def _sign_team(lang):
	return p(w(lang, "regards") + "<br><b>" + w(lang, "team") + "</b>", lang)


# ---------------------------------------------------------------- the emails
def send_code(t, code):
	lang = lang_of(t)
	body = p(w(lang, "code_intro"), lang)
	body += f'<div dir="ltr" style="margin:6px 0 18px;padding:16px;background:{SKY};border-radius:14px;text-align:center;font:800 34px/1 \'Courier New\',monospace;letter-spacing:8px;color:{NAVY}">{esc(code)}</div>'
	body += p(w(lang, "code_note"), lang, MUTED, 14)
	return deliver(t.email, w(lang, "code_subject", code=code), layout(lang, w(lang, "code_title"), body, to=t.email), now=True)


def welcome(t):
	"""The welcome letter from SMH Global Services' Managing Director, when the workspace is ready."""
	lang = lang_of(t)
	start = "right" if lang != "en" else "left"
	s = settings()
	u = urls(t, lang)
	signer = person(s.get("letter_name") or "Syed Mazhar Hasan", lang)
	title = person(s.get("letter_title") or "Managing Director", lang)
	until = date_text(t.trial_ends, lang)
	b = _greeting(t, lang)
	b += p(w(lang, "w_intro1", company=esc(t.company_name), signer=esc(signer), title=esc(title)), lang)
	b += p(w(lang, "w_intro2"), lang)
	b += h(w(lang, "w_ws"), lang)
	b += rows([
		(w(lang, "w_k_address"), ltr(f'<a href="{u["ws"]}" style="color:#284B78">{esc(t.site_host)}</a>')),
		(w(lang, "w_k_email"), ltr(esc(t.email))), (w(lang, "w_k_password"), w(lang, "w_password")),
		(w(lang, "w_k_plan"), w(lang, "w_plan", plan=esc(plan_label(t.plan, lang)))), (w(lang, "w_k_until"), until),
	], lang, start)
	b += button(u["ws"], w(lang, "open_ws"), lang)
	b += p(w(lang, "w_phone", android=ANDROID, android_short=ltr("buildiary.app/android"), sub=ltr(esc(t.name))), lang, MUTED, 14)
	b += h(w(lang, "w_steps"), lang) + numbered(W[lang]["steps"], lang, start)
	b += h(w(lang, "w_features"), lang) + bullets(W[lang]["features"], lang, start)
	b += h(w(lang, "w_promise"), lang) + box(bullets(W[lang]["promise"], lang, start))
	b += h(w(lang, "w_subscribe"), lang) + p(w(lang, "w_subscribe_intro", date=until), lang) + plans_block(t, lang, start)
	b += bank_block(t, lang, start)
	b += h(w(lang, "w_feedback"), lang) + p(w(lang, "w_feedback_text"), lang) + button(u["feedback"], w(lang, "feedback_btn"), lang)
	b += p(w(lang, "w_close"), lang)
	comma = "، " if lang in ("ur", "ar") else ", "
	b += p(w(lang, "regards") + f"<br><b>{esc(signer)}</b><br>{esc(title)}{comma}" + esc(entity(t.country, lang)), lang)
	html = layout(lang, w(lang, "w_title"), b, preheader=w(lang, "w_pre", host=t.site_host, date=until), to=t.email)
	return deliver(t.email, w(lang, "w_subject"), html, sender_name=f"{s.get('letter_name') or 'Syed Mazhar Hasan'} · Buildiary", ref=t)


def tips(t):
	lang = lang_of(t)
	start = "right" if lang != "en" else "left"
	u = urls(t, lang)
	b = _greeting(t, lang) + p(w(lang, "tips_intro", company=esc(t.company_name)), lang)
	b += numbered(W[lang]["tips"], lang, start) + button(u["ws"], w(lang, "open_ws"), lang)
	b += p(w(lang, "tips_help"), lang) + _sign_team(lang)
	return deliver(t.email, w(lang, "tips_subject"), layout(lang, w(lang, "tips_title"), b, to=t.email), ref=t)


def ask_feedback(t):
	lang = lang_of(t)
	u = urls(t, lang)
	b = _greeting(t, lang) + p(w(lang, "fb_intro", company=esc(t.company_name)), lang)
	b += button(u["feedback"], w(lang, "feedback_btn"), lang) + p(w(lang, "fb_more"), lang, MUTED, 14) + _sign_team(lang)
	return deliver(t.email, w(lang, "fb_subject"), layout(lang, w(lang, "fb_title"), b, to=t.email), ref=t)


def trial_ending(t, today=False):
	lang = lang_of(t)
	start = "right" if lang != "en" else "left"
	u = urls(t, lang)
	d = date_text(t.trial_ends, lang)
	b = _greeting(t, lang) + p(w(lang, "end_intro", company=esc(t.company_name), date=d), lang)
	b += plans_block(t, lang, start) + bank_block(t, lang, start) + button(u["billing"], w(lang, "pay_btn"), lang) + _sign_team(lang)
	subject = w(lang, "end0_subject") if today else w(lang, "end_subject", date=d)
	return deliver(t.email, subject, layout(lang, w(lang, "end_title", date=d), b, to=t.email), ref=t)


def ended(t, paused=False):
	"""The trial or plan has ended: open for the grace days (or already paused)."""
	lang = lang_of(t)
	start = "right" if lang != "en" else "left"
	u = urls(t, lang)
	what = "plan" if t.paid_until else "trial"
	end = t.paid_until or t.trial_ends
	until = date_text(add_days(end, cint(settings().grace_days)), lang)
	if paused:
		subject, title, intro = w(lang, "stop_subject"), w(lang, "stop_title"), w(lang, f"stop_intro_{what}", company=esc(t.company_name))
	else:
		subject, title = w(lang, f"due_subject_{what}"), w(lang, "due_title", until=until)
		intro = w(lang, f"due_intro_{what}", company=esc(t.company_name), date=date_text(end, lang), until=until)
	b = _greeting(t, lang) + p(intro, lang) + plans_block(t, lang, start) + bank_block(t, lang, start)
	b += button(u["billing"], w(lang, "pay_btn"), lang) + _sign_team(lang)
	return deliver(t.email, subject, layout(lang, title, b, to=t.email), ref=t)


def plan_ending(t):
	lang = lang_of(t)
	start = "right" if lang != "en" else "left"
	u = urls(t, lang)
	d = date_text(t.paid_until, lang)
	b = _greeting(t, lang) + p(w(lang, "renew_intro", plan=esc(plan_label(t.plan, lang)), company=esc(t.company_name), date=d), lang)
	b += bank_block(t, lang, start) + button(u["billing"], w(lang, "pay_btn"), lang) + _sign_team(lang)
	return deliver(t.email, w(lang, "renew_subject", date=d), layout(lang, w(lang, "renew_title"), b, to=t.email), ref=t)


def _payment_rows(pay, lang, with_dates=False):
	period = period_text(pay.periods, pay.billing_period, lang)
	if with_dates and pay.period_from and pay.period_to:
		period += "<br>" + w(lang, "from_to", a=date_text(pay.period_from, lang), b=date_text(pay.period_to, lang))
	return [
		(w(lang, "k_amount"), ltr(money(pay.amount, pay.currency))), (w(lang, "k_plan"), esc(plan_label(pay.plan, lang))), (w(lang, "k_period"), period),
		(w(lang, "k_paid_to"), esc(pay.paid_to)), (w(lang, "k_paid_on"), date_text(pay.paid_on, lang)),
		(w(lang, "k_reference"), pay.reference and ltr(esc(pay.reference))), (w(lang, "k_number"), ltr(esc(pay.name))),
	]


def payment_received(t, pay):
	"""Acknowledgement: the customer told us about a transfer."""
	lang = lang_of(t)
	start = "right" if lang != "en" else "left"
	b = _greeting(t, lang) + p(w(lang, "ack_intro", company=esc(t.company_name)), lang) + rows(_payment_rows(pay, lang), lang, start) + _sign_team(lang)
	return deliver(t.email, w(lang, "ack_subject"), layout(lang, w(lang, "ack_title"), b, to=t.email), ref=t)


def payment_confirmed(t, pay, fresh=False):
	lang = lang_of(t)
	start = "right" if lang != "en" else "left"
	u = urls(t, lang)
	b = _greeting(t, lang) + p(w(lang, "ok_intro", plan=esc(plan_label(pay.plan, lang)), company=esc(t.company_name), date=date_text(t.paid_until, lang)), lang)
	b += rows(_payment_rows(pay, lang, with_dates=True), lang, start) + p(w(lang, "ok_keep"), lang, MUTED, 14)
	if fresh:
		b += box(p(w(lang, "ok_fresh"), lang, size=15))
	b += button(u["ws"], w(lang, "open_ws"), lang) + p(w(lang, "w_feedback_text"), lang, MUTED, 14)
	b += p(f'<a href="{u["feedback"]}" style="color:#284B78">{w(lang, "feedback_btn")}</a>', lang, size=15) + _sign_team(lang)
	return deliver(t.email, w(lang, "ok_subject"), layout(lang, w(lang, "ok_title"), b, to=t.email), ref=t)


def payment_rejected(t, pay):
	lang = lang_of(t)
	start = "right" if lang != "en" else "left"
	u = urls(t, lang)
	b = _greeting(t, lang) + p(w(lang, "no_intro", company=esc(t.company_name), amount=ltr(money(pay.amount, pay.currency)), ref=ltr(esc(pay.reference or "-"))), lang)
	if pay.reject_reason:
		b += rows([(w(lang, "no_reason"), esc(pay.reject_reason))], lang, start)
	b += p(w(lang, "no_next"), lang) + bank_block(t, lang, start) + button(u["billing"], w(lang, "pay_btn"), lang) + _sign_team(lang)
	return deliver(t.email, w(lang, "no_subject"), layout(lang, w(lang, "no_title"), b, to=t.email), ref=t)


def feedback_thanks(fb):
	lang = fb.language if fb.language in LANGS else "en"
	start = "right" if lang != "en" else "left"
	b = p(w(lang, "hello", name=esc(fb.contact_name or "")), lang) + p(w(lang, "thanks_intro"), lang)
	b += rows([(w(lang, "thanks_copy"), esc(W[lang]["kinds"].get(fb.kind, fb.kind)) + "<br>" + esc(fb.message).replace("\n", "<br>"))], lang, start)
	b += _sign_team(lang)
	return deliver(fb.email, w(lang, "thanks_subject"), layout(lang, w(lang, "thanks_title"), b, to=fb.email), ref=fb)


def test(to, lang="en"):
	s = _s()
	b = p(w(lang, "test_intro", host=esc(s.control_host or frappe.local.site)), lang)
	return deliver(to, w(lang, "test_subject"), layout(lang, w(lang, "test_title"), b, to=to), now=True)


def password_reset(user, link, lang="en", minutes=20, host=None):
	"""From a workspace's sign-in screen: the link to choose a new password."""
	lang = lang if lang in LANGS else "en"
	host = host or frappe.local.site
	b = p(w(lang, "hello", name=esc(user.full_name or "")), lang)
	b += p(w(lang, "pw_intro", email=ltr(esc(user.email or user.name)), host=ltr(esc(host))), lang)
	b += button(link, w(lang, "pw_button"), lang)
	b += p(w(lang, "pw_expires", minutes=minutes), lang, MUTED, 14) + p(w(lang, "pw_ignore"), lang, MUTED, 14)
	html = layout(lang, w(lang, "pw_title"), b, preheader=w(lang, "pw_title"), to=user.email or user.name, why="foot_why_pw")
	return deliver(user.email or user.name, w(lang, "pw_subject"), html, soon=True)


# ---------------------------------------------------------------- follow-ups (from the daily check)
def follow_up(t, today=None):
	"""Sends the one email due today for this customer, if any (each is sent once).
	Trial: tips on day 2, a feedback request half-way, a reminder 3 days and on the last day,
	then 'ended' (grace days) and 'paused'. Paid plans: reminders 7 and 2 days before the end."""
	if t.is_internal or not t.email or t.status not in ("Trial", "Active", "Payment due", "Suspended"):
		return None
	today = getdate(today or nowdate())
	sent = set((t.get("emails_sent") or "").split())
	end = getdate(t.paid_until or t.trial_ends) if (t.paid_until or t.trial_ends) else None
	if not end:
		return None
	left = date_diff(end, today)
	key, fn = None, None
	if t.status == "Trial":
		start = getdate(t.signed_up_on or t.creation)
		days_in = date_diff(today, start)
		length = max(1, date_diff(end, start))
		if left == 0:
			key, fn = f"trial-0:{end}", lambda: trial_ending(t, today=True)
		elif 1 <= left <= 3:
			key, fn = f"trial-3:{end}", lambda: trial_ending(t)
		elif days_in >= max(5, length // 2) and left > 3:
			key, fn = "feedback", lambda: ask_feedback(t)
		elif days_in >= 2 and left > 3:
			key, fn = "tips", lambda: tips(t)
	elif t.status == "Active" and t.paid_until and left in (7, 2):
		key, fn = f"plan-{left}:{end}", lambda: plan_ending(t)
	elif t.status == "Payment due":
		key, fn = f"due:{end}", lambda: ended(t)
	elif t.status == "Suspended" and not t.paused_by_admin:
		key, fn = f"stop:{end}", lambda: ended(t, paused=True)
	if not key or key in sent:
		return None
	# the 3-day reminder isn't repeated on the following days
	if key.startswith("trial-3") and any(k.startswith("trial-3") for k in sent):
		return None
	if fn():
		sent.add(key)
		t.db_set("emails_sent", " ".join(sorted(sent))[:1000], update_modified=False)
		return key
	return None
