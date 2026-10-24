"""AI reading of supplier documents: quotations, proposals, message screenshots,
delivery notes, bills and invoices. Printed or handwritten, English or Urdu.

The key is stored encrypted in Mimaar Settings and never sent to the browser.
"""

import base64
import json
import re

import frappe
import requests
from frappe import _
from frappe.utils import flt

DEFAULT_MODEL = {"Gemini": "gemini-3.8-flash", "Claude": "claude-sonnet-5-5"}

QUOTE_SHAPE = """{"supplier": {"name": string, "phone": string, "contact": string, "email": string, "address": string, "ntn": string},
 "docNo": string, "date": "YYYY-MM-DD" | "", "validUntil": "YYYY-MM-DD" | "",
 "lines": [{"item": string, "unit": string, "qty": number, "rate": number, "discountPercent": number, "amount": number}],
 "discountAmount": number, "taxPercent": number, "otherCharges": number, "grandTotal": number,
 "paymentTerms": string, "advancePercent": number, "deliveryTime": string, "terms": string}"""

DELIVERY_SHAPE = """{"docType": "delivery note" | "bill" | "invoice" | "other", "docNo": string, "date": "YYYY-MM-DD" | "",
 "vehicle": string, "driver": string, "poNo": string,
 "lines": [{"item": string, "qty": number, "unit": string, "lineIndex": number | null}], "notes": string}"""

INVOICE_SHAPE = """{"supplierName": string, "invoiceNo": string, "date": "YYYY-MM-DD" | "", "dueDate": "YYYY-MM-DD" | "", "poNo": string,
 "lines": [{"item": string, "qty": number, "unit": string, "rate": number, "amount": number, "lineIndex": number | null}],
 "subtotal": number, "taxAmount": number, "otherCharges": number, "grandTotal": number, "notes": string}"""

URDU = "It may be printed or handwritten, in English or Urdu (Urdu digits too), or a screenshot of a WhatsApp, SMS or e-mail message. Read handwriting and Urdu carefully."


def _cfg():
	s = frappe.get_single("Mimaar Settings")
	if s.ai_provider in (None, "", "Off"):
		frappe.throw(_("AI reading is off. Choose Gemini or Claude and paste the API key in Settings."), title=_("AI not set up"))
	key = s.get_password("ai_api_key", raise_exception=False)
	if not key:
		frappe.throw(_("Paste the API key in Settings."), title=_("AI not set up"))
	return s.ai_provider, key, (s.ai_model or DEFAULT_MODEL[s.ai_provider])


def _file(file_url):
	f = frappe.get_doc("File", {"file_url": file_url})
	if f.attached_to_doctype and f.attached_to_name and frappe.db.exists(f.attached_to_doctype, f.attached_to_name):
		frappe.get_doc(f.attached_to_doctype, f.attached_to_name).check_permission("read")
	data = f.get_content()
	if isinstance(data, str):
		data = data.encode()
	name = (f.file_name or file_url).lower()
	mime = "application/pdf" if name.endswith(".pdf") else "image/png" if name.endswith(".png") else "image/webp" if name.endswith(".webp") else "image/jpeg"
	if len(data) > 15 * 1024 * 1024:
		frappe.throw(_("The file is too large to read (over 15 MB)."))
	return mime, base64.b64encode(data).decode()


def ask(prompt, file_url):
	fake = frappe.conf.get("mimaar_fake_ai_file")
	if fake:  # tests only: a JSON reply from a file named in site_config.json
		frappe.local.mimaar_last_prompt = prompt
		with open(fake) as fh:
			return json.load(fh)
	return _call(prompt, [_file(file_url)])


def _file_raw(file_url):
	"""A file's content for a check made by the server itself (no user permission involved)."""
	f = frappe.get_doc("File", {"file_url": file_url})
	data = f.get_content()
	if isinstance(data, str):
		data = data.encode()
	name = (f.file_name or file_url).lower()
	mime = "application/pdf" if name.endswith(".pdf") else "image/png" if name.endswith(".png") else "image/webp" if name.endswith(".webp") else "image/jpeg"
	return mime, base64.b64encode(data).decode()


def ask_many(prompt, file_urls, max_tokens=2048):
	"""A check made by the server itself on a record's own photos (several images, one answer)."""
	fake = frappe.conf.get("mimaar_fake_ai_file")
	if fake:  # tests only
		frappe.local.mimaar_last_prompt = prompt
		with open(fake) as fh:
			return json.load(fh)
	return _call(prompt, [_file_raw(u) for u in file_urls if u], max_tokens=max_tokens)


def _call(prompt, files, max_tokens=8192):
	"""Send the prompt and the images/PDFs to the AI chosen in Mimaar Settings; the reply must be JSON."""
	provider, key, model = _cfg()
	try:
		if provider == "Gemini":
			parts = [{"text": prompt}] + [{"inline_data": {"mime_type": m, "data": b}} for m, b in files]
			r = requests.post(
				f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
				headers={"x-goog-api-key": key, "content-type": "application/json"},
				json={"contents": [{"role": "user", "parts": parts}], "generationConfig": {"maxOutputTokens": max_tokens, "responseMimeType": "application/json"}},
				timeout=120,
			)
			r.raise_for_status()
			out = ((r.json().get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
			text = "".join(p.get("text", "") for p in out if not p.get("thought"))
		else:
			blocks = [{"type": "document", "source": {"type": "base64", "media_type": m, "data": b}} if m == "application/pdf"
				else {"type": "image", "source": {"type": "base64", "media_type": m, "data": b}} for m, b in files]
			r = requests.post(
				"https://api.anthropic.com/v1/messages",
				headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
				json={"model": model, "max_tokens": min(max_tokens, 4000), "messages": [{"role": "user", "content": blocks + [{"type": "text", "text": prompt}]}]},
				timeout=120,
			)
			r.raise_for_status()
			text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
	except requests.HTTPError as e:
		code = e.response.status_code if e.response is not None else 0
		frappe.throw(_("The AI service refused the request ({0}). Check the API key and model in Settings.").format(code), title=_("AI error"))
	except requests.RequestException:
		frappe.throw(_("Couldn't reach the AI service. Check the internet connection and try again."), title=_("AI error"))
	m = re.search(r"\{[\s\S]*\}", text or "")
	if not m:
		frappe.throw(_("The AI couldn't read this document. Try a clearer photo."), title=_("AI error"))
	try:
		return json.loads(m.group(0))
	except ValueError:
		frappe.throw(_("The AI couldn't read this document. Try a clearer photo."), title=_("AI error"))


FACE_PROMPT = """Image 1 is the registered photo of a person working on a house construction site in Pakistan.
Image 2 was taken just now with a phone camera, to identify the same person before an entry (signing in, attendance, taking material from the store, receiving goods or cash).
Decide whether image 2 shows the same person as image 1. Ignore differences in clothes, cap, beard trim, lighting, dust and camera quality.
Image 2 should show a real person in front of the camera: if it looks like a photo of a printed photo or of a phone or computer screen, say so.
Reply with only JSON: {"face_visible": true|false, "same_person": true|false, "confidence": 0-100, "photo_of_photo": true|false, "notes": "one short sentence in English"}"""


def compare_faces(registered_url, live_url):
	"""Is the person in the photo taken now the registered person? (Gemini or Claude, as set in Mimaar Settings.)"""
	fake = frappe.conf.get("mimaar_fake_face_file")
	if fake:  # tests only
		with open(fake) as fh:
			return json.load(fh)
	return _call(FACE_PROMPT, [_file_raw(registered_url), _file_raw(live_url)], max_tokens=1024)


# ---------------------------------------------------------------- matching
def _items():
	return frappe.get_all("Item", filters={"disabled": 0}, fields=["name", "item_name", "stock_uom"], limit_page_length=2000)


def _norm(t):
	t = re.sub(r"(\d)([a-z])", r"\1 \2", str(t or "").lower())
	return re.sub(r"[^a-z0-9\u0600-\u06ff]+", " ", t).strip()


def match_item(text, items=None):
	"""The catalogue item this line names, only when it is clearly the same item.
	The AI is asked to use the catalogue names, so a close match is required;
	anything doubtful is left for the person to choose."""
	if not text:
		return None
	items = items or _items()
	q = _norm(text)
	for i in items:
		if q in (_norm(i.item_name), _norm(i.name)):
			return i.name
	from rapidfuzz import fuzz, process

	choices = {i.name: _norm(i.item_name) for i in items}
	best = process.extractOne(q, choices, scorer=fuzz.token_sort_ratio)
	return best[2] if best and best[1] >= 90 else None


def match_supplier(name):
	if not name:
		return None
	from rapidfuzz import fuzz, process

	sups = {s.name: s.supplier_name for s in frappe.get_all("Supplier", fields=["name", "supplier_name"], limit_page_length=2000)}
	best = process.extractOne(_norm(name), {k: _norm(v) for k, v in sups.items()}, scorer=fuzz.token_sort_ratio)
	return best[2] if best and best[1] >= 90 else None


def _num(v):
	try:
		return flt(str(v).translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")).replace(",", ""))
	except Exception:
		return 0


def _latin(s):
	return str(s or "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")).strip()


# ---------------------------------------------------------------- the three readers
@frappe.whitelist()
def read_quotation(file_url):
	frappe.has_permission("Supplier Quotation", "create", throw=True)
	items = _items()
	cat = "; ".join(f"{i.item_name} ({i.stock_uom})" for i in items[:400])
	d = ask(
		f"This is a supplier's quotation or proposal for a house under construction in Pakistan. {URDU} "
		f"Extract the supplier and every line exactly as written. Amounts are Pakistani rupees as plain numbers; give rates per unit. "
		f"Name each item as the closest match from this catalogue when one fits, otherwise as written: {cat}\n"
		f"Leave a field empty when it is not on the document. Reply with only JSON of this shape:\n{QUOTE_SHAPE}",
		file_url,
	)
	sup = d.get("supplier") or {}
	lines = []
	for x in d.get("lines") or []:
		if not (x.get("item") or x.get("rate") or x.get("amount")):
			continue
		qty = _num(x.get("qty")) or 1
		rate = _num(x.get("rate")) or (_num(x.get("amount")) / qty if qty else 0)
		lines.append({"item_code": match_item(x.get("item"), items), "text": x.get("item") or "", "uom": x.get("unit") or "", "qty": qty, "rate": rate, "discount_percentage": _num(x.get("discountPercent"))})
	return {
		"supplier": match_supplier(sup.get("name")),
		"supplier_details": {k: _latin(v) if k in ("phone", "ntn") else (v or "") for k, v in sup.items()},
		"quotation_number": _latin(d.get("docNo")),
		"transaction_date": d.get("date") or None,
		"valid_till": d.get("validUntil") or None,
		"lines": lines,
		"discount_amount": _num(d.get("discountAmount")),
		"tax_percent": _num(d.get("taxPercent")),
		"other_charges": _num(d.get("otherCharges")),
		"grand_total": _num(d.get("grandTotal")),
		"payment_terms": d.get("paymentTerms") or "",
		"advance_percent": _num(d.get("advancePercent")),
		"delivery_time": d.get("deliveryTime") or "",
		"terms": d.get("terms") or "",
	}


def _po_lines(doctype, name):
	doc = frappe.get_doc(doctype, name)
	doc.check_permission("write")
	return doc, [f"{i}: {r.item_name or r.item_code} ({r.uom}), quantity on this document {flt(r.qty)}" for i, r in enumerate(doc.items)]


@frappe.whitelist()
def read_delivery(file_url, doctype, name):
	doc, lines = _po_lines(doctype, name)
	po = ", ".join(sorted({r.purchase_order for r in doc.items if r.get("purchase_order")}))
	d = ask(
		f"This is a supplier's delivery note, challan or bill for goods delivered to a house under construction in Pakistan. {URDU} "
		f"It should be against purchase order {po} from {doc.supplier_name}. The lines we expect are:\n" + "\n".join(lines) +
		f"\nRead every line on the document and give lineIndex = the number of the matching expected line (or null). Reply with only JSON of this shape:\n{DELIVERY_SHAPE}",
		file_url,
	)
	return _with_index(d, doc)


@frappe.whitelist()
def read_invoice(file_url, doctype, name):
	doc, lines = _po_lines(doctype, name)
	d = ask(
		f"This is a supplier's invoice or bill for a house under construction in Pakistan. {URDU} "
		f"It is from {doc.supplier_name}. The lines we expect (from the goods received) are:\n" + "\n".join(lines) +
		f"\nRead every line and give lineIndex = the number of the matching expected line (or null). Amounts in Pakistani rupees as plain numbers. Reply with only JSON of this shape:\n{INVOICE_SHAPE}",
		file_url,
	)
	return _with_index(d, doc)


def _with_index(d, doc):
	items = [{"item_code": r.item_code, "item_name": r.item_name} for r in doc.items]
	out = []
	for x in d.get("lines") or []:
		k = x.get("lineIndex")
		if not isinstance(k, int) or k < 0 or k >= len(items):
			code = match_item(x.get("item"), [frappe._dict(name=i["item_code"], item_name=i["item_name"], stock_uom="") for i in items])
			k = next((i for i, it in enumerate(items) if it["item_code"] == code), None)
		out.append({"index": k, "text": x.get("item") or "", "qty": _num(x.get("qty")), "rate": _num(x.get("rate")), "amount": _num(x.get("amount"))})
	d["lines"] = out
	for k in ("docNo", "invoiceNo", "vehicle", "poNo"):
		if d.get(k):
			d[k] = _latin(d[k])
	for k in ("subtotal", "taxAmount", "otherCharges", "grandTotal"):
		if k in d:
			d[k] = _num(d[k])
	return d
