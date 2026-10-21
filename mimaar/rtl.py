"""Urdu is a right-to-left language. Frappe decides the page direction with
frappe.utils.jinja_globals.is_rtl(), whose list is ["ar", "he", "fa", "ps"]. Several
modules import that function directly, so the function's code is replaced once per
process (every module then sees the new list)."""

RTL = ["ar", "he", "fa", "ps", "ur"]
_done = False


def _is_rtl(rtl=None):
	from frappe import local

	if rtl is None:
		return local.lang in ["ar", "he", "fa", "ps", "ur"]
	return rtl


def apply():
	global _done
	if _done:
		return
	try:
		from frappe.utils import jinja_globals

		jinja_globals.is_rtl.__code__ = _is_rtl.__code__
		_done = True
	except Exception:
		pass


def boot(bootinfo):
	apply()
	import frappe

	try:
		provider = frappe.db.get_single_value("Mimaar Settings", "ai_provider")
		lock_po = frappe.db.get_single_value("Mimaar Settings", "lock_submitted_po")
	except Exception:
		provider, lock_po = None, 1
	bootinfo.mimaar = {
		"rtl": RTL,
		"ai": bool((provider and provider != "Off") or frappe.conf.get("mimaar_fake_ai_file")),
		"lock_po": bool(lock_po),
	}


apply()
