import zipfile
import os

zip_path = r"E:\app.new_backup\StreamLume_Source_Backup.zip"
extract_path = r"e:\streamlume-tv\StreamLume_Source"

if not os.path.exists(extract_path):
    os.makedirs(extract_path)

print("Opening zip file...")
with zipfile.ZipFile(zip_path, 'r') as zf:
    for file_info in zf.infolist():
        # skip useless large folders to speed up and avoid long paths
        if "/android/" in file_info.filename or \
           "/ios/" in file_info.filename or \
           "/node_modules/" in file_info.filename or \
           "/.git/" in file_info.filename:
            continue
        try:
            zf.extract(file_info, extract_path)
        except Exception as e:
            print(f"Failed to extract {file_info.filename}: {e}")

print("Extraction complete!")
