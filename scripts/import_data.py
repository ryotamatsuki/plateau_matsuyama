"""Extract the original LOD1 building tiles without altering coordinates or properties."""
import pathlib,sys,zipfile
root=pathlib.Path(__file__).resolve().parents[1]
with zipfile.ZipFile(sys.argv[1]) as z:
 prefix='38201_matsuyama-shi_city_2020_citygml_7_op_bldg_3dtiles_lod1/'
 assert prefix+'tileset.json' in z.namelist()
 for entry in z.infolist():
  if not entry.filename.startswith(prefix) or entry.is_dir():continue
  rel=pathlib.PurePosixPath(entry.filename[len(prefix):])
  assert not rel.is_absolute() and '..' not in rel.parts
  out=root/'data/buildings'/rel
  out.parent.mkdir(parents=True,exist_ok=True)
  out.write_bytes(z.read(entry))
print('Imported original LOD1 building tiles')
