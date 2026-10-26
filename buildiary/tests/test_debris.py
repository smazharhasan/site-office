"""Debris removal (buildiary.debris): skips on site, asking the company to collect, collections, the regular schedule."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate, nowdate

from buildiary import debris
from buildiary.tests.test_procurement import a_file


def _no(prefix="SK"):
	return f"{prefix}-{frappe.generate_hash(length=5).upper()}"


def _company_supplier(name="Test Skip Co", phone="0300-5551234", email="skips@example.com"):
	from buildiary.api import register_supplier

	return register_supplier(name, phone=phone, email=email, work_area="Waste removal")


class TestDebris(IntegrationTestCase):
	def setUp(self):
		frappe.db.set_single_value("Buildiary Settings", "debris_enabled", 1)
		frappe.db.set_single_value("Buildiary Settings", "debris_email_supplier", 1)
		self.sup = _company_supplier()
		self.mails = []
		p = patch("frappe.sendmail", side_effect=lambda **kw: self.mails.append(kw))
		p.start()
		self.addCleanup(p.stop)

	def test_default_by_country(self):
		self.assertTrue(debris.default_on("Saudi Arabia"))
		self.assertTrue(debris.default_on("United Arab Emirates"))
		self.assertFalse(debris.default_on("Pakistan"))
		self.assertFalse(debris.default_on("Germany"))

	def test_skip_request_and_collection(self):
		no = _no()
		k = debris.skip_save({"container_no": no.lower(), "supplier": self.sup, "size_m3": 10, "location": "Street side", "every_days": 3})
		doc = frappe.get_doc("Debris Container", k)
		self.assertEqual(doc.container_no, no)
		self.assertEqual(str(doc.next_collection), str(add_days(nowdate(), 3)))
		self.assertFalse(debris.fill_save(k, "Half full")["suggest"])
		self.assertTrue(debris.fill_save(k, "Full", photo=a_file())["suggest"])
		self.assertTrue(any(a["go"][0] == "debris" and no in a["t"] for a in debris.attention()))

		r = debris.request({"kind": "Exchange (full for empty)", "container": k, "reason": "Full"})
		self.assertTrue(r["whatsapp"].startswith("https://wa.me/92300555"))
		self.assertIn(no, r["message"])
		self.assertTrue(r["emailed"])
		self.assertEqual(self.mails[-1]["recipients"], ["skips@example.com"])
		self.assertEqual(frappe.db.get_value("Debris Container", k, "status"), "Collection requested")
		with self.assertRaises(frappe.ValidationError):  # one open request per skip
			debris.request({"kind": "Exchange (full for empty)", "container": k})
		with self.assertRaises(frappe.ValidationError):  # a photo after the collection is needed
			debris.done({"name": r["name"], "vehicle_no": "abc-12"})
		debris.done({"name": r["name"], "vehicle_no": "abc-12", "slip_no": "T-9", "photo_done": a_file(), "cost": 350})
		rem = frappe.get_doc("Debris Removal", r["name"])
		self.assertEqual((rem.status, rem.vehicle_no, rem.slip_no), ("Done", "ABC-12", "T-9"))
		doc.reload()
		self.assertEqual((doc.status, doc.fill), ("On site", "Empty"))
		self.assertEqual(str(doc.next_collection), str(add_days(nowdate(), 3)))

		ov = debris.overview()
		self.assertTrue(ov["enabled"])
		self.assertTrue(any(s.name == k for s in ov["skips"]))
		self.assertGreaterEqual(ov["month"]["trips"], 1)

		# taken away for good
		r2 = debris.request({"kind": "Take away", "container": k})
		debris.done({"name": r2["name"], "photo_done": a_file()})
		self.assertEqual(frappe.db.get_value("Debris Container", k, "status"), "Removed")

	def test_trip_without_a_skip_and_cancel(self):
		r = debris.request({"kind": "Truck / trolley trip", "supplier": self.sup, "reason": "Site clean-up"})
		self.assertIn(frappe.db.get_value("Supplier", self.sup, "supplier_name"), r["message"])
		debris.cancel(r["name"])
		self.assertEqual(frappe.db.get_value("Debris Removal", r["name"], "status"), "Cancelled")
		# a trolley that came without being asked in the app: recorded straight away
		name = debris.done({"kind": "Truck / trolley trip", "supplier": self.sup, "loads": 2, "photo_done": a_file()})
		self.assertEqual(frappe.db.get_value("Debris Removal", name, ["status", "loads"]), ("Done", 2))

	def test_regular_collection(self):
		k = debris.skip_save({"container_no": _no(), "supplier": self.sup, "every_days": 7})
		frappe.db.set_value("Debris Container", k, "next_collection", add_days(nowdate(), -1))
		debris.daily()
		r = frappe.get_all("Debris Removal", filters={"container": k, "status": "Requested"}, fields=["name", "reason", "notified"])
		self.assertEqual(len(r), 1)
		self.assertEqual(r[0].reason, "Scheduled")
		self.assertEqual(r[0].notified, "Email")
		debris.daily()  # not asked twice
		self.assertEqual(frappe.db.count("Debris Removal", {"container": k, "status": "Requested"}), 1)

	def test_permit_warning(self):
		a, b = _no(), _no()
		k = debris.skip_save({"container_no": a, "supplier": self.sup, "permit_no": "P-1", "permit_expires": add_days(nowdate(), 2)})
		debris.skip_save({"container_no": b, "supplier": self.sup})  # no permit: no warning
		warn = [x["t"] for x in debris.attention(getdate(nowdate()))]
		self.assertTrue(any(a in x for x in warn))
		self.assertFalse(any(b in x for x in warn))
		with self.assertRaises(frappe.ValidationError):  # the same number twice on site
			debris.skip_save({"container_no": a.lower(), "supplier": self.sup})
		self.assertTrue(k)
