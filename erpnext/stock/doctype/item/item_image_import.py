# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public Public License v3. See license.txt

import io
import os
import zipfile
from typing import TYPE_CHECKING

import frappe
from frappe import _
from frappe.core.doctype.file.file import File
from frappe.utils import cint, get_files_path

if TYPE_CHECKING:
	from frappe.core.doctype.file.file import File as FileDoc


# 支持的图片格式
SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
# 单张图片最大大小（5MB）
MAX_IMAGE_SIZE = 5 * 1024 * 1024


@frappe.whitelist(methods=["POST"])
def import_item_images():
	"""
	导入物料图片
	接收上传的ZIP文件，解压后根据文件名匹配物料编码，更新物料的image字段
	"""
	# 检查权限
	if not frappe.has_permission("Item", "write"):
		frappe.throw(_("You don't have permission to update Item"), frappe.PermissionError)

	# 获取上传的文件
	if "file" not in frappe.request.files:
		frappe.throw(_("Please upload a ZIP file"))

	uploaded_file = frappe.request.files["file"]
	update_strategy = frappe.form_dict.get("update_strategy", "overwrite")

	# 验证文件类型
	if not uploaded_file.filename.lower().endswith(".zip"):
		frappe.throw(_("Please upload a ZIP file"))

	# 读取文件内容
	file_content = uploaded_file.stream.read()

	# 处理ZIP文件
	result = process_zip_file(file_content, update_strategy)

	return result


@frappe.whitelist(methods=["POST"])
def import_item_images_from_url(file_url: str, update_strategy: str = "overwrite"):
	"""
	通过文件URL导入物料图片

	Args:
		file_url: 上传的ZIP文件URL
		update_strategy: 更新策略 ("overwrite" 或 "skip")

	Returns:
		包含导入结果的字典
	"""
	# 检查权限
	if not frappe.has_permission("Item", "write"):
		frappe.throw(_("You don't have permission to update Item"), frappe.PermissionError)

	# 获取文件内容
	file_content = get_file_content_from_url(file_url)

	# 处理ZIP文件
	result = process_zip_file(file_content, update_strategy)

	return result


def get_file_content_from_url(file_url: str) -> bytes:
	"""
	从文件URL获取文件内容

	Args:
		file_url: 文件URL（如 /files/xxx.zip 或完整路径）

	Returns:
		文件内容
	"""
	# 从URL获取文件名
	if file_url.startswith("/files/"):
		# 公开文件
		file_path = get_files_path(file_url.replace("/files/", ""))
	elif file_url.startswith("/private/files/"):
		# 私有文件
		file_path = get_files_path(file_url.replace("/private/files/", ""), is_private=1)
	else:
		# 尝试从File DocType获取
		file_doc = frappe.get_doc("File", {"file_url": file_url})
		file_path = file_doc.get_full_path()

	# 读取文件内容
	if not os.path.exists(file_path):
		frappe.throw(_("File not found: {0}").format(file_url))

	with open(file_path, "rb") as f:
		return f.read()


def process_zip_file(file_content: bytes, update_strategy: str = "overwrite") -> dict:
	"""
	处理ZIP文件，提取图片并更新物料

	Args:
		file_content: ZIP文件内容
		update_strategy: 更新策略 ("overwrite" 或 "skip")

	Returns:
		包含导入结果的字典
	"""
	result = {
		"total_files": 0,
		"success_count": 0,
		"failed_count": 0,
		"skipped_count": 0,
		"errors": [],
	}

	try:
		zip_buffer = io.BytesIO(file_content)
		with zipfile.ZipFile(zip_buffer, "r") as zip_ref:
			# 获取所有文件
			all_files = zip_ref.namelist()
			result["total_files"] = len(all_files)

			# 过滤出图片文件
			image_files = [
				f for f in all_files
				if os.path.splitext(f.lower())[1] in SUPPORTED_IMAGE_EXTENSIONS
			]

			for image_file in image_files:
				try:
					# 获取文件名（不含扩展名）作为物料编码
					filename = os.path.basename(image_file)
					item_code, ext = os.path.splitext(filename)

					if not item_code:
						result["failed_count"] += 1
						result["errors"].append({
							"file": image_file,
							"reason": _("Invalid filename")
						})
						continue

					# 检查物料是否存在
					if not frappe.db.exists("Item", item_code):
						result["failed_count"] += 1
						result["errors"].append({
							"file": image_file,
							"reason": _("Item {0} does not exist").format(item_code)
						})
						continue

					# 检查物料是否已有图片
					current_image = frappe.db.get_value("Item", item_code, "image")
					if current_image and update_strategy == "skip":
						result["skipped_count"] += 1
						continue

					# 读取图片内容
					image_content = zip_ref.read(image_file)

					# 检查图片大小
					if len(image_content) > MAX_IMAGE_SIZE:
						result["failed_count"] += 1
						result["errors"].append({
							"file": image_file,
							"reason": _("Image size exceeds limit (5MB)")
						})
						continue

					# 保存图片文件
					file_url = save_image_file(filename, image_content, item_code)

					# 更新物料图片字段
					frappe.db.set_value("Item", item_code, "image", file_url)
					result["success_count"] += 1

				except Exception as e:
					result["failed_count"] += 1
					result["errors"].append({
						"file": image_file,
						"reason": str(e)
					})

	except zipfile.BadZipFile:
		frappe.throw(_("Invalid ZIP file"))
	except Exception as e:
		frappe.throw(_("Error processing ZIP file: {0}").format(str(e)))

	return result


def save_image_file(filename: str, content: bytes, item_code: str) -> str:
	"""
	保存图片文件到Frappe文件系统

	Args:
		filename: 文件名
		content: 文件内容
		item_code: 关联的物料编码

	Returns:
		文件的URL
	"""
	# 创建文件夹（如果不存在）
	folder_name = "Home/Item Images"
	if not frappe.db.exists("File", {"file_name": "Item Images", "is_folder": 1}):
		home_folder = frappe.db.get_value("File", {"is_home_folder": 1})
		if home_folder:
			folder = frappe.get_doc({
				"doctype": "File",
				"file_name": "Item Images",
				"is_folder": 1,
				"folder": "Home"
			})
			folder.insert(ignore_permissions=True)
			folder_name = folder.name

	# 创建文件文档
	file_doc = frappe.get_doc({
		"doctype": "File",
		"file_name": filename,
		"content": content,
		"attached_to_doctype": "Item",
		"attached_to_name": item_code,
		"attached_to_field": "image",
		"folder": folder_name,
		"is_private": 0,  # 公开访问
	})
	file_doc.insert(ignore_permissions=True)

	return file_doc.file_url


@frappe.whitelist()
def get_import_preview():
	"""
	预览导入结果
	返回ZIP文件中的图片文件列表和匹配状态
	"""
	if "file" not in frappe.request.files:
		frappe.throw(_("Please upload a ZIP file"))

	uploaded_file = frappe.request.files["file"]

	if not uploaded_file.filename.lower().endswith(".zip"):
		frappe.throw(_("Please upload a ZIP file"))

	file_content = uploaded_file.stream.read()

	preview_result = {
		"total_files": 0,
		"image_files": [],
		"matched_items": 0,
		"unmatched_items": 0,
	}

	try:
		zip_buffer = io.BytesIO(file_content)
		with zipfile.ZipFile(zip_buffer, "r") as zip_ref:
			all_files = zip_ref.namelist()
			preview_result["total_files"] = len(all_files)

			image_files = [
				f for f in all_files
				if os.path.splitext(f.lower())[1] in SUPPORTED_IMAGE_EXTENSIONS
			]

			for image_file in image_files:
				filename = os.path.basename(image_file)
				item_code, ext = os.path.splitext(filename)

				# 检查物料是否存在
				item_exists = frappe.db.exists("Item", item_code)
				current_image = None

				if item_exists:
					current_image = frappe.db.get_value("Item", item_code, "image")
					preview_result["matched_items"] += 1
				else:
					preview_result["unmatched_items"] += 1

				preview_result["image_files"].append({
					"filename": filename,
					"item_code": item_code,
					"item_exists": item_exists,
					"current_image": current_image,
				})

	except zipfile.BadZipFile:
		frappe.throw(_("Invalid ZIP file"))
	except Exception as e:
		frappe.throw(_("Error processing ZIP file: {0}").format(str(e)))

	return preview_result