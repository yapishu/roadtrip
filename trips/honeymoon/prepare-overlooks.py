from pathlib import Path
import json
from pyproj import Transformer
root=Path(__file__).resolve().parent;p=Transformer.from_crs(4326,5070,always_xy=True);j=json.loads((root/'journey.json').read_text())
for source,meta in j['sources'].items():
 if not source:continue
 plan=json.loads((root/source/'plan.json').read_text());route=json.loads((root/source/'route.json').read_text());views=[]
 for place,stop in zip(plan['stops'][1:-1],route['stops'][1:-1]):views.append(dict(name=stop['name'],at=stop['at'],xy=list(p.transform(place['lon'],place['lat']))))
 meta['views']=views
(root/'journey.json').write_text(json.dumps(j,separators=(',',':')))
