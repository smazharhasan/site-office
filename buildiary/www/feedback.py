"""/feedback on the Buildiary console: feedback, feature requests, problems and questions
(English, Urdu, Arabic). The emails link here with the customer's workspace filled in."""

import hashlib
import hmac
import json
import re

import frappe

no_cache = 1
sitemap = 0


def link_key(tenant):
	"""The key in our emails' feedback links, so only they fill in the customer's name and email."""
	secret = (frappe.local.conf.get("encryption_key") or frappe.local.site).encode()
	return hmac.new(secret, f"feedback:{tenant}".encode(), hashlib.sha256).hexdigest()[:32]


def get_context(context):
	from buildiary.saas.common import is_control, settings

	if not is_control():
		raise frappe.DoesNotExistError
	s = settings()
	f = frappe.form_dict
	ws = (f.get("w") or "").strip().lower()
	kind = f.get("kind") if f.get("kind") in ("Feedback", "Feature request", "Problem", "Question") else ""
	name = email = ""
	if not (ws and re.match(r"^[a-z][a-z0-9-]{1,40}$", ws) and frappe.db.exists("Buildiary Tenant", ws)):
		ws = ""
	elif hmac.compare_digest(link_key(ws), (f.get("k") or "")[:32]):
		# a link from our own email: the customer's name and email are filled in
		name, email = frappe.db.get_value("Buildiary Tenant", ws, ["contact_name", "email"]) or ("", "")
	lang = f.get("lang") or ""
	context.no_cache = 1
	context.cfg = json.dumps({
		"lang": lang if lang in ("en", "ur", "ar") else "", "website": s.website_url or "", "w": ws, "n": name or "", "e": email or "", "kind": kind,
	}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
	return context
