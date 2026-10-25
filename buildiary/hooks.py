app_name = "mimaar"
app_title = "Buildiary"
app_publisher = "SMH Global Services (Pvt) Ltd"
app_description = "Construction procurement, stores, supplier accounts and site management on ERPNext"
app_email = "info@smhglobal.com.pk"
app_license = "mit"
required_apps = ["frappe/erpnext"]
app_logo_url = "/assets/mimaar/images/buildiary-logo.svg"
app_home = "/desk/mimaar"

add_to_apps_screen = [
	{
		"name": app_name,
		"logo": "/assets/mimaar/images/buildiary-logo.svg",
		"title": app_title,
		"route": app_home,
	}
]

app_include_js = ["/assets/mimaar/js/mimaar.js"]
app_include_css = ["/assets/mimaar/css/mimaar.css"]

doctype_js = {
	"Supplier": "public/js/supplier.js",
	"Supplier Quotation": "public/js/supplier_quotation.js",
	"Request for Quotation": "public/js/request_for_quotation.js",
	"Purchase Order": "public/js/purchase_order.js",
	"Purchase Receipt": "public/js/purchase_receipt.js",
	"Purchase Invoice": "public/js/purchase_invoice.js",
	"Payment Entry": "public/js/payment_entry.js",
	"Stock Entry": "public/js/stock_entry.js",
}
doctype_list_js = {
	"Supplier Quotation": "public/js/supplier_quotation_list.js",
	"Supplier": "public/js/supplier_list.js",
}

website_context = {
	"favicon": "/assets/mimaar/images/buildiary-logo.svg",
	"splash_image": "/assets/mimaar/images/buildiary-logo.svg",
}

jinja = {"methods": ["mimaar.api.qr_code", "mimaar.identity.card_code"]}

before_install = "mimaar.setup.before_install"
before_migrate = "mimaar.setup.before_install"

override_whitelisted_methods = {
	"erpnext.controllers.accounts_controller.update_child_qty_rate": "mimaar.procurement.update_items",
}

doc_events = {
	"Site Worker": {"on_update": "mimaar.identity.on_worker_update"},
	# each new document belongs to the person's current project (mimaar.projects)
	**{dt: {"before_insert": "mimaar.projects.tag"} for dt in ("Site Diary", "Site Inspection", "Site Snag", "Site Attendance", "Petty Cash Entry",
		"Water Tank", "Water Tank Reading", "Water Tanker")},
	"Supplier Quotation": {
		"before_insert": "mimaar.projects.tag",
		"validate": "mimaar.procurement.sq_validate",
		"before_cancel": "mimaar.procurement.sq_before_cancel",
	},
	"Purchase Order": {
		"before_insert": "mimaar.projects.tag",
		"validate": "mimaar.procurement.po_validate",
		"before_cancel": "mimaar.procurement.po_before_cancel",
	},
	"Purchase Receipt": {"before_insert": "mimaar.projects.tag", "before_submit": "mimaar.procurement.pr_before_submit"},
	"Purchase Invoice": {"before_insert": "mimaar.projects.tag", "before_submit": "mimaar.procurement.pi_before_submit"},
	"Payment Entry": {
		"before_insert": "mimaar.projects.tag",
		"validate": "mimaar.procurement.pe_validate",
		"before_submit": "mimaar.procurement.pe_before_submit",
	},
	"Communication": {"before_insert": "mimaar.procurement.comm_before_insert"},
	"Stock Entry": {"before_insert": "mimaar.projects.tag", "before_submit": "mimaar.procurement.se_before_submit"},
	# Mabni Cloud: a plan's limits on people and projects
	"User": {"before_insert": "mimaar.saas.tenant.check_users"},
	"Project": {"before_insert": "mimaar.saas.tenant.check_projects"},
}

# Mabni Cloud: the console keeps the pool of ready workspaces, checks plans every day
scheduler_events = {
	"daily": ["mimaar.saas.billing.daily"],
	"cron": {"*/10 * * * *": ["mimaar.saas.provision.tick"]},
}
get_website_user_home_page = "mimaar.saas.tenant.home_page"

# Urdu is written right to left (Frappe's list of RTL languages doesn't include it)
before_request = ["mimaar.rtl.apply", "mimaar.saas.tenant.enforce"]
boot_session = "mimaar.rtl.boot"

after_install = "mimaar.setup.after_install"
after_migrate = "mimaar.setup.after_migrate"
setup_wizard_complete = "mimaar.setup.after_setup"
