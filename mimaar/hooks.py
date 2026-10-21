app_name = "mimaar"
app_title = "Mimaar"
app_publisher = "SMH Global Services (Pvt) Ltd"
app_description = "Construction procurement, stores, supplier accounts and site management on ERPNext"
app_email = "info@smhglobal.com.pk"
app_license = "mit"
required_apps = ["frappe/erpnext"]
app_logo_url = "/assets/mimaar/images/mimaar-logo.svg"
app_home = "/desk/mimaar"

add_to_apps_screen = [
	{
		"name": app_name,
		"logo": "/assets/mimaar/images/mimaar-logo.svg",
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

jinja = {"methods": ["mimaar.api.qr_code"]}

before_install = "mimaar.setup.before_install"
before_migrate = "mimaar.setup.before_install"

override_whitelisted_methods = {
	"erpnext.controllers.accounts_controller.update_child_qty_rate": "mimaar.procurement.update_items",
}

doc_events = {
	"Supplier Quotation": {
		"validate": "mimaar.procurement.sq_validate",
		"before_cancel": "mimaar.procurement.sq_before_cancel",
	},
	"Purchase Order": {
		"validate": "mimaar.procurement.po_validate",
		"before_cancel": "mimaar.procurement.po_before_cancel",
	},
	"Purchase Receipt": {"before_submit": "mimaar.procurement.pr_before_submit"},
	"Purchase Invoice": {"before_submit": "mimaar.procurement.pi_before_submit"},
	"Payment Entry": {
		"validate": "mimaar.procurement.pe_validate",
		"before_submit": "mimaar.procurement.pe_before_submit",
	},
	"Communication": {"before_insert": "mimaar.procurement.comm_before_insert"},
	"Stock Entry": {"before_submit": "mimaar.procurement.se_before_submit"},
}

# Urdu is written right to left (Frappe's list of RTL languages doesn't include it)
before_request = ["mimaar.rtl.apply"]
boot_session = "mimaar.rtl.boot"

after_install = "mimaar.setup.after_install"
after_migrate = "mimaar.setup.after_migrate"
setup_wizard_complete = "mimaar.setup.after_setup"
