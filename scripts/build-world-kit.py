#!/usr/bin/env python3
"""Pack reviewed regional wall surfaces and transparent vegetation for the 3D viewer."""
import argparse,json,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageStat

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--trip',type=Path,required=True);args=ap.parse_args();art=args.trip/'regional/art';plan=json.loads((art/'plan.json').read_text());clean=json.loads((art/'kit.json').read_text())if(art/'kit.json').exists()else{'pictures':{}};out=art/'world';out.mkdir(exist_ok=True)
    drops=set((art/'drop.txt').read_text().split())if(art/'drop.txt').exists()else set();kit=dict(themes=plan['themes'],surfaces={},trees={},sources={'surfaces':'Locally generated SDXL regional architecture','vegetation':'Locally generated SDXL vegetation'})
    plants=json.loads((art/'plants.json').read_text())if(art/'plants.json').exists()else {};tiles={};review=[]
    for job in plan['jobs']:
        if job['name']in drops:continue
        if job['kind']=='texture':
            path=art/'raw'/(job['name']+'.png')
            if not path.exists():continue
            im=Image.open(path).convert('RGB');w,h=im.size;im=im.crop((round(w*.045),round(h*.22),round(w*.955),round(h*.83))).resize((256,96),Image.Resampling.LANCZOS);tiles.setdefault(job['theme'],[]).append((job,im));review.append((job['name'],im))
        else:
            item=plants.get(job['name']) or clean['pictures'].get(job['name'])
            if not item or item.get('drop'):continue
            src=(art/'plants'if job['name']in plants else art)/(job['name']+'.png');im=Image.open(src).convert('RGBA');target=out/(job['name']+'.png');im.save(target);kit['trees'][job['name']]=dict(theme=job['theme'],regions=job.get('regions',[job['theme']]),file='regional/art/world/'+target.name,height=job['hm'],aspect=im.width/im.height);review.append((job['name'],im))
    for theme,items in tiles.items():
        atlas=Image.new('RGB',(2048,math.ceil(len(items)/8)*128),'#888078')
        for i,(job,im)in enumerate(items):
            x=i%8*256;y=i//8*128;atlas.paste(im,(x,y));kit['surfaces'][job['name']]=dict(theme=theme,role=job['role'],file=f'regional/art/world/{theme}-walls.jpg',rect=[x,y,256,96],size=list(atlas.size),avg=[round(v)for v in ImageStat.Stat(im).mean],width=12 if job['role']=='house'else 10)
        atlas.save(out/(theme+'-walls.jpg'),quality=92)
    (art/'world-kit.json').write_text(json.dumps(kit,separators=(',',':')))
    cols=6;cw=270;ch=150;sheet=Image.new('RGB',(cols*cw,math.ceil(len(review)/cols)*ch),'#666669');draw=ImageDraw.Draw(sheet)
    for i,(name,im)in enumerate(review):
        tile=im.copy();tile.thumbnail((256,124));x=i%cols*cw;y=i//cols*ch;sheet.paste(tile,(x+(cw-tile.width)//2,y),tile if tile.mode=='RGBA'else None);draw.text((x+4,y+129),name,fill='white')
    sheet.save(art/'world-contact.jpg',quality=92);print(f'{len(kit["surfaces"])} wall surfaces, {len(kit["trees"])} vegetation assets')
if __name__=='__main__':main()
