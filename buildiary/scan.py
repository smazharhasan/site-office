"""A phone as the QR scanner for a computer or tablet.

The field screens on a computer ask for a pairing and show it as a QR code. Any phone opens it
with its camera (/scan?k=<key>, no app and no sign-in: the key is the pass), reads site cards and
sends each code here; the computer picks them up. One pairing serves many scans for a working day.
Nothing but the scanned text is kept, in the cache, and it expires on its own."""

import secrets
import time

import frappe
from frappe.rate_limiter import rate_limit
from frappe.utils import cint

TTL = 10 * 3600  # a working day
LANGS = ("en", "ur", "ar")


def _key(k):
	return f"buildiary-scan:{k}"


def get(k):
	if not k or not isinstance(k, str) or len(k) > 64 or not k.replace("-", "").replace("_", "").isalnum():
		return None
	return frappe.cache.get_value(_key(k))


def _put(k, v):
	frappe.cache.set_value(_key(k), v, expires_in_sec=TTL)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=30, seconds=600)
def pair(lang=None):
	"""A new pairing: its key, the address the phone opens, and that address as a QR code."""
	from buildiary.api import qr_code

	k = secrets.token_urlsafe(18)
	_put(k, {"q": [], "phone": 0, "lang": lang if lang in LANGS else "en", "made": time.time()})
	url = f"{frappe.utils.get_url()}/scan?k={k}"
	return {"key": k, "url": url, "qr": qr_code(url)}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=1500, seconds=600)
def take(key=None, clear=0):
	"""The computer asks: the next code the phone scanned (oldest first), and whether the phone is there."""
	d = get(key)
	if not d:
		return {"alive": False}
	text = None
	if cint(clear):
		d["q"] = []
	elif d["q"]:
		text = d["q"].pop(0)["t"]
	_put(key, d)
	seen = round(time.time() - d["phone"]) if d.get("phone") else None
	return {"alive": True, "text": text, "phone": seen}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=600, seconds=600)
def hello(key=None):
	"""The phone's page says it is open (every few seconds)."""
	d = get(key)
	if not d:
		return {"alive": False}
	d["phone"] = time.time()
	_put(key, d)
	return {"alive": True, "lang": d.get("lang") or "en"}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=300, seconds=600)
def push(key=None, text=None):
	"""The phone read a code: keep it for the computer."""
	d = get(key)
	text = (text or "").strip()
	if not d:
		return {"alive": False}
	if not text:
		return {"alive": True, "ok": False}
	d["q"] = (d["q"] + [{"t": text[:300], "at": time.time()}])[-20:]
	d["phone"] = time.time()
	_put(key, d)
	return {"alive": True, "ok": True}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def end(key=None):
	if get(key):
		frappe.cache.delete_value(_key(key))
	return {"ok": True}
