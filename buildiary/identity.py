"""Site cards, signing in with the card and a PIN, and the face check.

Every person on the project has a site card. Its QR code carries a secret code (not just the
worker number), so a card can't be faked by printing a number. Wherever a person is identified
for money or material (store issue and return, receiving goods, petty cash, signing in), the
card is scanned and a photo taken now is compared by the AI with the person's registered photo.
Every check is kept as an Identity Check record for the owner.
"""

import base64
import hashlib
import hmac
import re
import secrets

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import add_to_date, cint, get_datetime, getdate, now_datetime, today

PREFIX = "MMR1:"
MAX_TRIES = 5
LOCK_MINUTES = 15
CHECK_VALID_MINUTES = 20
ACCESS_PROFILES = {"Site supervisor": ["Buildiary Site Supervisor"], "Owner's supervisor": ["Buildiary Owner Supervisor"], "Partner (builder or consultant)": ["Buildiary Partner"],
	"Accountant": ["Buildiary Accountant"], "Owner": ["Buildiary Owner"]}


def _s():
	return frappe.get_cached_doc("Buildiary Settings")


def is_owner():
	return "System Manager" in frappe.get_roles()


# ---------------------------------------------------------------- cards
def ensure_card(person):
	name = frappe.db.get_value("Site Card", {"person": person})
	if name:
		return frappe.get_doc("Site Card", name)
	doc = frappe.get_doc({"doctype": "Site Card", "person": person, "token": secrets.token_urlsafe(18), "version": 1, "issued_on": now_datetime()})
	doc.insert(ignore_permissions=True)
	return doc


def card_code(person):
	"""The text in the QR code of the printed site card."""
	return PREFIX + ensure_card(person).token


@frappe.whitelist()
def card_qr(person):
	"""QR image of the site card (for printing the card)."""
	frappe.get_doc("Site Worker", person).check_permission("print")
	from buildiary.api import qr_code

	return qr_code(card_code(person))


def person_from_code(code):
	"""(person, card scanned?) for a scanned card, or a typed worker number / CNIC / society card number."""
	code = (code or "").strip()
	if code.startswith(PREFIX):
		p = frappe.db.get_value("Site Card", {"token": code[len(PREFIX):]}, "person")
		return (p, True) if p else (None, False)
	m = re.search(r"WRK-\d+", code, re.I)
	if m and frappe.db.exists("Site Worker", m.group(0).upper()):
		return m.group(0).upper(), False
	digits = re.sub(r"\D", "", code)
	if len(digits) == 13:
		p = frappe.db.get_value("Site Worker", {"cnic": f"{digits[:5]}-{digits[5:12]}-{digits[12]}"})
		if p:
			return p, False
	p = frappe.db.get_value("Site Worker", {"entry_card_no": code}) if code else None
	return p, False


def _hash(pin, salt):
	return hashlib.pbkdf2_hmac("sha256", str(pin).encode(), bytes.fromhex(salt), 120000).hex()


def _check_pin_format(pin):
	if not re.fullmatch(r"\d{4,6}", str(pin or "")):
		frappe.throw(_("The PIN must be 4 to 6 digits."))


def _set_pin(card, pin):
	_check_pin_format(pin)
	card.pin_salt = secrets.token_hex(16)
	card.pin_hash = _hash(pin, card.pin_salt)
	card.pin_set = 1
	card.failed_attempts = 0
	card.locked_until = None


@frappe.whitelist()
def card_info(person):
	frappe.only_for("System Manager")
	c = ensure_card(person)
	return {"version": c.version, "issued_on": c.issued_on, "sign_in_enabled": c.sign_in_enabled, "pin_set": c.pin_set,
		"last_sign_in": c.last_sign_in, "locked": bool(c.locked_until and get_datetime(c.locked_until) > now_datetime()),
		"user": frappe.db.get_value("Site Worker", person, "user")}


@frappe.whitelist()
def new_card(person, pin=None):
	"""Owner: a new card. The old card stops working for signing in (attendance still finds the person by number)."""
	frappe.only_for("System Manager")
	c = ensure_card(person)
	c.token = secrets.token_urlsafe(18)
	c.version = cint(c.version) + 1
	c.issued_on = now_datetime()
	if pin:
		_set_pin(c, pin)
		c.sign_in_enabled = 1
	c.save(ignore_permissions=True)
	return card_info(person)


@frappe.whitelist()
def set_card_pin(person, pin, enable=1):
	"""Owner: set the PIN for signing in with the card, and turn card sign-in on."""
	frappe.only_for("System Manager")
	if not frappe.db.get_value("Site Worker", person, "user"):
		frappe.throw(_("Give this person access to Buildiary first (Signs in as)."))
	c = ensure_card(person)
	_set_pin(c, pin)
	c.sign_in_enabled = cint(enable)
	c.save(ignore_permissions=True)
	return card_info(person)


@frappe.whitelist()
def card_sign_in_off(person):
	frappe.only_for("System Manager")
	c = ensure_card(person)
	c.sign_in_enabled = 0
	c.save(ignore_permissions=True)
	return card_info(person)


def my_person():
	return frappe.db.get_value("Site Worker", {"user": frappe.session.user})


@frappe.whitelist()
def change_my_pin(current, new):
	person = my_person()
	if not person:
		frappe.throw(_("Your user is not linked to a person in the register."))
	c = ensure_card(person)
	if c.pin_set and not hmac.compare_digest(_hash(current, c.pin_salt), c.pin_hash or ""):
		frappe.throw(_("The current PIN is not correct."))
	_set_pin(c, new)
	c.save(ignore_permissions=True)
	return {"ok": 1}


# ---------------------------------------------------------------- face check
def _save_photo(data_url, person):
	"""A photo sent with the sign-in (before there is a session to upload with)."""
	m = re.match(r"^data:image/(jpeg|jpg|png|webp);base64,(.+)$", data_url or "", re.S)
	raw = base64.b64decode(m.group(2) if m else (data_url or ""), validate=False)
	if not raw or len(raw) > 6 * 1024 * 1024:
		frappe.throw(_("The photo couldn't be read. Take it again."))
	f = frappe.get_doc({"doctype": "File", "file_name": f"face-{person}-{frappe.generate_hash(length=8)}.jpg", "content": raw, "is_private": 1})
	f.flags.ignore_permissions = True
	f.insert(ignore_permissions=True)
	return f.file_url


def _decide(r, threshold):
	if not r.get("face_visible", True):
		return "Unclear", 0
	conf = max(0, min(100, cint(r.get("confidence"))))
	if r.get("photo_of_photo"):
		return "No match", 0
	if r.get("same_person") and conf >= threshold:
		return "Match", conf
	if not r.get("same_person") and conf >= threshold:
		return "No match", 100 - conf
	return "Unclear", conf if r.get("same_person") else 100 - conf


def face_check(person, photo_url=None, photo_data=None, action="Other", card_scanned=0, location=None):
	"""Compare a photo taken now with the person's registered photo; keep the result."""
	s = _s()
	p = frappe.get_doc("Site Worker", person) if isinstance(person, str) else person
	if photo_data:
		photo_url = _save_photo(photo_data, p.name)
	doc = frappe.get_doc({"doctype": "Identity Check", "person": p.name, "action": action, "live_photo": photo_url,
		"registered_photo": p.photo, "card_scanned": cint(card_scanned), "location": location, "checked_at": now_datetime()})
	result, score, notes = "Not checked", 0, ""
	if s.face_check == "Off":
		notes = _("Face check is off in Settings.")
	elif not p.photo:
		notes = _("No registered photo for this person.")
	elif not photo_url:
		notes = _("No photo taken.")
	else:
		from buildiary import ai

		try:
			r = ai.compare_faces(p.photo, photo_url)
			result, score = _decide(r, cint(s.face_threshold) or 70)
			notes = (r.get("notes") or "")[:500]
		except frappe.ValidationError as e:
			frappe.clear_messages()
			notes = _("Not checked: {0}").format(str(e)[:200])
	doc.result, doc.score, doc.notes = result, score, notes
	doc.insert(ignore_permissions=True)
	if result == "No match":
		_tell_owner(doc)
	return doc


def _tell_owner(check):
	for user in frappe.get_all("Has Role", filters={"role": "System Manager", "parenttype": "User"}, pluck="parent"):
		if user in ("Administrator", "Guest") or not frappe.db.get_value("User", user, "enabled"):
			continue
		frappe.get_doc({"doctype": "Notification Log", "for_user": user, "type": "Alert", "document_type": "Identity Check", "document_name": check.name,
			"subject": _("Face did not match: {0} ({1})").format(check.person_name or check.person, _(check.action))}).insert(ignore_permissions=True)


def blocks(check):
	"""Does this check stop the entry? (only when the owner made the face check required)."""
	return _s().face_check == "Required" and check.result in ("No match", "Unclear")


@frappe.whitelist()
def verify(code, photo, action, location=None, need_card=1):
	"""In the app: scan the person's card, take their photo now; the AI compares it with the registered photo."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Sign in first."), frappe.PermissionError)
	person, scanned = person_from_code(code)
	if not person:
		frappe.throw(_("This card is not recognised. Is the person registered?"), title=_("Unknown card"))
	if cint(need_card) and not scanned:
		frappe.throw(_("Scan the person's site card. Typing the number is not enough here."), title=_("Scan the card"))
	p = frappe.get_doc("Site Worker", person)
	if p.status != "Active":
		frappe.throw(_("{0} is {1} in the register and can't be used here.").format(p.full_name, _(p.status)), title=_("Not allowed"))
	check = face_check(p, photo_url=photo, action=action, card_scanned=scanned, location=location)
	out = {"check": check.name, "person": p.name, "full_name": p.full_name, "full_name_ur": p.full_name_ur, "photo": p.photo,
		"trade": p.trade, "worker_type": p.worker_type, "result": check.result, "score": check.score, "notes": check.notes,
		"warnings": p.warnings(), "ok": not blocks(check)}
	if not out["ok"]:
		out["message"] = _("The photo does not match {0}'s registered photo. Take the photo again, facing the camera in good light.").format(p.full_name) \
			if check.result == "No match" else _("The face is not clear in the photo. Take it again, facing the camera in good light.")
	frappe.db.commit()  # keep the check even if the entry is not made
	return out


def use_check(name, action, doctype=None, docname=None, person=None):
	"""An entry made with a face check: the check must be recent, unused, for this action and not failed."""
	if not name:
		return None
	c = frappe.get_doc("Identity Check", name)
	if c.used:
		frappe.throw(_("This face check was already used. Scan the card again."))
	if c.action != action:
		frappe.throw(_("This face check was for {0}, not {1}.").format(_(c.action), _(action)))
	if person and c.person != person:
		frappe.throw(_("The face check is for another person."))
	if get_datetime(c.checked_at) < add_to_date(now_datetime(), minutes=-CHECK_VALID_MINUTES):
		frappe.throw(_("The face check is too old. Scan the card again."))
	if blocks(c):
		frappe.throw(_("The face check did not pass. Scan the card and take the photo again."))
	frappe.db.set_value("Identity Check", c.name, {"used": 1, "reference_doctype": doctype, "reference_name": docname})
	return c


def needs_card(rule):
	return cint(_s().get(rule))


# ---------------------------------------------------------------- signing in with the card
@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=30, seconds=600)
def sign_in(code, pin, photo=None):
	"""Sign in with the site card (scanned), the person's PIN and a photo of the face taken now."""
	s = _s()
	if not cint(s.card_sign_in):
		frappe.throw(_("Signing in with the site card is turned off."))
	fail = _("This card and PIN were not accepted.")
	code = (code or "").strip()
	if not code.startswith(PREFIX):
		frappe.throw(_("Scan your site card."))
	cname = frappe.db.get_value("Site Card", {"token": code[len(PREFIX):]})
	if not cname:
		frappe.throw(fail)
	card = frappe.get_doc("Site Card", cname)
	if not card.sign_in_enabled or not card.pin_set:
		frappe.throw(_("Signing in with this card is not turned on. Ask the owner."))
	if card.locked_until and get_datetime(card.locked_until) > now_datetime():
		frappe.throw(_("Too many wrong PINs. Try again after {0}.").format(get_datetime(card.locked_until).strftime("%H:%M")))
	if not hmac.compare_digest(_hash(pin, card.pin_salt), card.pin_hash or ""):
		card.failed_attempts = cint(card.failed_attempts) + 1
		if card.failed_attempts >= MAX_TRIES:
			card.locked_until, card.failed_attempts = add_to_date(now_datetime(), minutes=LOCK_MINUTES), 0
		card.save(ignore_permissions=True)
		frappe.db.commit()
		frappe.throw(fail)
	p = frappe.get_doc("Site Worker", card.person)
	if p.status != "Active" or not p.user or not frappe.db.get_value("User", p.user, "enabled"):
		frappe.throw(_("This card is not allowed to sign in. Ask the owner."))
	if s.face_check != "Off":
		if not photo:
			frappe.throw(_("Take a photo of your face to sign in."))
		check = face_check(p, photo_data=photo, action="Sign in", card_scanned=1)
		frappe.db.set_value("Identity Check", check.name, {"checked_by": p.user, "used": 1})
		if blocks(check):
			frappe.db.commit()
			frappe.throw(_("The photo does not match your registered photo. Face the camera in good light and try again.")
				if check.result == "No match" else _("Your face is not clear in the photo. Face the camera in good light and try again."))
	card.failed_attempts, card.locked_until, card.last_sign_in = 0, None, now_datetime()
	card.save(ignore_permissions=True)
	frappe.local.login_manager.login_as(p.user)
	return {"ok": 1, "full_name": p.full_name}


# ---------------------------------------------------------------- access to the app for a person
def sync_user(p):
	"""Create or update the person's user from 'Signs in as' and 'store keeper' (owner only)."""
	access = p.app_access or "No sign-in"
	profiles = list(ACCESS_PROFILES.get(access, []))
	if cint(p.store_keeper):
		profiles.append("Buildiary Store Keeper")
	if not profiles:
		if p.user and frappe.db.exists("User", p.user) and p.user != "Administrator":
			frappe.db.set_value("User", p.user, "enabled", 0)
		return p.user
	if p.user and frappe.db.exists("User", p.user):
		u = frappe.get_doc("User", p.user)
	else:
		email = f"{p.name.lower()}@staff.buildiary"
		u = frappe.get_doc("User", email) if frappe.db.exists("User", email) else frappe.new_doc("User")
		u.email = email
		u.send_welcome_email = 0
	u.first_name = p.full_name
	u.enabled = 1
	u.user_type = "System User"
	if u.name == "Administrator":
		return u.name
	u.set("role_profiles", [{"role_profile": rp} for rp in profiles if frappe.db.exists("Role Profile", rp)])
	if not u.get("new_password") and u.is_new():
		u.new_password = secrets.token_urlsafe(24)  # they sign in with the card and PIN
	u.flags.ignore_permissions = True
	u.flags.no_welcome_mail = True
	u.save() if not u.is_new() else u.insert()
	if u.user_image != p.photo and p.photo:
		frappe.db.set_value("User", u.name, "user_image", p.photo)
	return u.name


def on_worker_update(doc, method=None):
	"""Keep the person's card and user in step with the register."""
	ensure_card(doc.name)
	if doc.has_value_changed("app_access") or doc.has_value_changed("store_keeper") or doc.has_value_changed("status") or doc.has_value_changed("full_name"):
		if doc.status != "Active" and doc.user:
			frappe.db.set_value("User", doc.user, "enabled", 0)
			frappe.db.set_value("Site Card", {"person": doc.name}, "sign_in_enabled", 0)
			return
		if doc.app_access and (doc.app_access != "No sign-in" or doc.store_keeper or doc.user):
			user = sync_user(doc)
			if user and user != doc.user:
				frappe.db.set_value("Site Worker", doc.name, "user", user)
				doc.user = user


def check_expiry(doc):
	return [x for x, d in ((_("CNIC"), doc.cnic_expiry), (_("entry card"), doc.entry_card_expiry)) if d and getdate(d) < getdate(today())]
