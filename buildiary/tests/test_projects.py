"""Several projects in one workspace (Builder mode). Run: bench --site <site> run-tests --app buildiary --module buildiary.tests.test_projects"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate, nowdate

from buildiary import field, projects


class TestProjects(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		frappe.local.buildiary_projects = {}
		frappe.local.conf.pop("buildiary", None)

	def tearDown(self):
		frappe.defaults.clear_user_default(projects.KEY)
		frappe.local.buildiary_projects = {}
		frappe.db.rollback()

	def _first(self):
		live = projects._live()
		if not live:
			frappe.get_doc({"doctype": "Project", "project_name": "First " + frappe.generate_hash(length=4), "status": "Open"}).insert()
			frappe.local.buildiary_projects = {}
			live = projects._live()
		return live

	def test_second_project(self):
		live = self._first()
		first = projects.current()
		self.assertTrue(first)
		single = len(live) == 1
		if single:
			self.assertFalse(projects.multi())
			self.assertEqual(field._only({"docstatus": 1}), {"docstatus": 1})
			self.assertEqual(projects.sql("p"), "")
		old_store = projects.store()
		name = "House 14 " + frappe.generate_hash(length=4)
		start = getdate(nowdate())
		r = projects.new({"title": name, "address": "DHA Phase 6", "start": str(start), "end": str(add_days(start, 300)), "schedule": 1})
		self.assertEqual(r["stages"], 14)
		frappe.local.buildiary_projects = {}
		# the new project is now this person's project, with its own store
		self.assertEqual(projects.current(), r["name"])
		self.assertTrue(projects.multi())
		new_store = projects.store()
		self.assertTrue(new_store)
		self.assertNotEqual(new_store, old_store)
		self.assertEqual(field._store(), new_store)
		self.assertEqual(field._only({"docstatus": 1}), {"docstatus": 1, "project": r["name"]})
		self.assertIn(frappe.db.escape(r["name"]), projects.sql("p"))
		# the schedule fits between the start and the finish
		tasks = frappe.get_all("Task", filters={"project": r["name"]}, fields=["exp_start_date", "exp_end_date", "buildiary_phase"])
		self.assertEqual(len(tasks), 14)
		self.assertTrue(all(getdate(t.exp_start_date) >= start and getdate(t.exp_end_date) <= add_days(start, 300) for t in tasks))
		self.assertTrue(all(t.buildiary_phase for t in tasks))
		# a new site record belongs to the current project; the old project's records stay with it
		d = frappe.get_doc({"doctype": "Site Diary", "date": nowdate(), "weather": "Sunny", "workers": 3, "work_done": "Marking out"}).insert()
		self.assertEqual(d.project, r["name"])
		if single:
			self.assertEqual(frappe.db.get_value("Project", first, "buildiary_store"), frappe.db.get_single_value("Buildiary Settings", "site_warehouse") or None)
			self.assertEqual(frappe.db.count("Site Diary", {"project": ["in", ["", None]]}), 0)
		self.assertEqual([x.name for x in field.diary()], [d.name])
		# back to the first project
		projects.switch(first)
		frappe.local.buildiary_projects = {}
		self.assertEqual(projects.current(), first)
		self.assertNotIn(d.name, [x.name for x in field.diary()])
		self.assertEqual(field._store(), projects.store(first))
		# the switcher lists both, the current one marked
		b = {p["name"]: p for p in projects.brief()}
		self.assertTrue(b[first]["current"])
		self.assertFalse(b[r["name"]]["current"])

	def test_rules(self):
		self._first()
		with self.assertRaises(frappe.ValidationError):
			projects.new({"title": "x"})
		with self.assertRaises(frappe.ValidationError):
			projects.new({"title": "Backwards " + frappe.generate_hash(length=4), "start": nowdate(), "end": str(add_days(nowdate(), -5))})
		# the plan counts open projects only; closing one makes room
		have = frappe.db.count("Project", {"status": "Open"})
		frappe.local.conf["buildiary"] = {"limits": {"projects": have}}
		try:
			with self.assertRaises(frappe.ValidationError):
				projects.new({"title": "Over " + frappe.generate_hash(length=4)})
			frappe.local.conf["buildiary"] = {"limits": {"projects": have + 1}}
			r = projects.new({"title": "Small job " + frappe.generate_hash(length=4), "schedule": 0})
			self.assertEqual(r["stages"], 0)
			projects.edit(r["name"], {"status": "Completed"})
			frappe.local.buildiary_projects = {}
			projects.new({"title": "Next job " + frappe.generate_hash(length=4), "schedule": 0})
			with self.assertRaises(frappe.ValidationError):
				projects.edit(r["name"], {"status": "Open"})
		finally:
			frappe.local.conf.pop("buildiary", None)
		# only the owner adds projects
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			projects.new({"title": "Not mine"})
		frappe.set_user("Administrator")
