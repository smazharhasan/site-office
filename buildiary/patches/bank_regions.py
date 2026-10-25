"""Bank accounts are now chosen by region: Pakistan, the UAE, or Saudi Arabia and all other countries."""

import frappe


def execute():
	frappe.db.sql("""update `tabBuildiary Bank Account` set country='Saudi Arabia and all other countries'
		where country in ('Saudi Arabia', 'Any country') or country is null or country=''""")
	if frappe.db.exists("DocType", "Buildiary Cloud Settings"):
		s = frappe.get_single("Buildiary Cloud Settings")
		if not s.usd_to_qar:
			frappe.db.set_single_value("Buildiary Cloud Settings", {"usd_to_qar": 3.64, "round_qar": 5})
