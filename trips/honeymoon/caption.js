const FONT = (() => { const r = s => s.split(' '); return {
    A: r('.###. #...# #...# ##### #...# #...# #...#'), B: r('####. #...# #...# ####. #...# #...# ####.'), C: r('.###. #...# #.... #.... #.... #...# .###.'), D: r('####. #...# #...# #...# #...# #...# ####.'),
    E: r('##### #.... #.... ####. #.... #.... #####'), F: r('##### #.... #.... ####. #.... #.... #....'), G: r('.###. #...# #.... #.### #...# #...# .####'), H: r('#...# #...# #...# ##### #...# #...# #...#'),
    I: r('### .#. .#. .#. .#. .#. ###'), J: r('..### ...#. ...#. ...#. ...#. #..#. .##..'), K: r('#...# #..#. #.#.. ##... #.#.. #..#. #...#'), L: r('#.... #.... #.... #.... #.... #.... #####'),
    M: r('#...# ##.## #.#.# #.#.# #...# #...# #...#'), N: r('#...# #...# ##..# #.#.# #..## #...# #...#'), O: r('.###. #...# #...# #...# #...# #...# .###.'), P: r('####. #...# #...# ####. #.... #.... #....'),
    Q: r('.###. #...# #...# #...# #.#.# #..#. .##.#'), R: r('####. #...# #...# ####. #.#.. #..#. #...#'), S: r('.#### #.... #.... .###. ....# ....# ####.'), T: r('##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..'),
    U: r('#...# #...# #...# #...# #...# #...# .###.'), V: r('#...# #...# #...# #...# #...# .#.#. ..#..'), W: r('#...# #...# #...# #.#.# #.#.# #.#.# .#.#.'), X: r('#...# #...# .#.#. ..#.. .#.#. #...# #...#'),
    Y: r('#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..'), Z: r('##### ....# ...#. ..#.. .#... #.... #####'),
    0: r('.###. #...# #..## #.#.# ##..# #...# .###.'), 1: r('.#. ##. .#. .#. .#. .#. ###'), 2: r('.###. #...# ....# ...#. ..#.. .#... #####'), 3: r('####. ....# ....# .###. ....# ....# ####.'),
    4: r('...#. ..##. .#.#. #..#. ##### ...#. ...#.'), 5: r('##### #.... ####. ....# ....# #...# .###.'), 6: r('.###. #.... #.... ####. #...# #...# .###.'), 7: r('##### ....# ...#. ..#.. .#... .#... .#...'),
    8: r('.###. #...# #...# .###. #...# #...# .###.'), 9: r('.###. #...# #...# .#### ....# ....# .###.'),
    ' ': r('... ... ... ... ... ... ...'), '.': r('. . . . . . #'), ',': r('.. .. .. .. .. .# #.'), '-': r('... ... ... ### ... ... ...'), "'": r('# # . . . . .'), '&': r('.##.. #..#. .##.. .#... #.#.# #..#. .##.#'), '/': r('....# ...#. ...#. ..#.. .#... .#... #....'), '<': r('...#. ..#.. .#... #.... .#... ..#.. ...#.'), '>': r('.#... ..#.. ...#. ....# ...#. ..#.. .#...') }; })();

const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replaceAll('→', '>').replaceAll('·', '-');
const widthOf = value => [...value].reduce((n, c) => n + (FONT[c]?.[0].length || 5) + 1, -1);
function write(ctx, value, x, y, scale, color) {
 ctx.fillStyle=color;
 for(const c of value){const glyph=FONT[c]||FONT[' '];glyph.forEach((row,dy)=>[...row].forEach((v,dx)=>{if(v==='#')ctx.fillRect(x+dx*scale,y+dy*scale,scale,scale);}));x+=(glyph[0].length+1)*scale;}
}
let lastKey='';
export function drawCaption(canvas, value) {
 const width=Math.max(200,Math.round(canvas.getBoundingClientRect().width));
 const scale=width>=700?3:2, height=scale*21, key=width+'|'+value;
 if(key===lastKey)return;lastKey=key;
 canvas.width=width;canvas.height=height;canvas.style.height=height+'px';canvas.setAttribute('aria-label',value);
 const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
 const lines=[];let line='';
 for(const word of normalize(value).split(' ')){const trial=line?line+' '+word:word;if(widthOf(trial)*scale>width-16&&line){lines.push(line);line=word;}else line=trial;}if(line)lines.push(line);
 lines.forEach((line,i)=>{const x=Math.floor((width-widthOf(line)*scale)/2),y=height-(lines.length-i)*9*scale;write(ctx,line,x+scale,y+scale,scale,'#211c27');write(ctx,line,x,y,scale,'#fff2d9');});
}
