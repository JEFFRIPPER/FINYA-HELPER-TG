from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math, json, wave, struct, subprocess

ROOT = Path(__file__).parent / "src/main/resources/assets/jujutsu_neon"
TEX = ROOT / "textures/particle/vfx"
SOUNDS = ROOT / "sounds"
PART = ROOT / "particles"
ITEM = ROOT / "textures/item"
ARMOR = ROOT / "textures/models/armor"
MODEL = ROOT / "models/item"
LANG = ROOT / "lang"
for p in [TEX, SOUNDS, PART, ITEM, ARMOR, MODEL, LANG]:
    p.mkdir(parents=True, exist_ok=True)

names = [
    "blue","max_blue","red","hollow_purple","black_flash","cursed_barrage",
    "infinity","domain","rct","teleport","dash","shockwave","star","slash","trail"
]
colors = {
    "blue":(30,210,255),"max_blue":(25,140,255),"red":(255,30,55),
    "hollow_purple":(185,40,255),"black_flash":(255,25,75),
    "cursed_barrage":(225,40,125),"infinity":(85,210,255),
    "domain":(130,45,255),"rct":(55,255,175),"teleport":(80,175,255),
    "dash":(60,220,255),"shockwave":(100,225,255),"star":(225,90,255),
    "slash":(245,70,255),"trail":(100,205,255)
}

# Draw at 1024 then upscale to 4096. This keeps build time sane while shipping 4K assets.
def make_vfx(name, rgb):
    s=1024; c=s//2
    im=Image.new("RGBA",(s,s),(0,0,0,0))
    glow=Image.new("RGBA",(s,s),(0,0,0,0)); gd=ImageDraw.Draw(glow)
    for width,alpha in [(150,18),(90,35),(48,70),(18,180)]:
        gd.ellipse((150,150,s-150,s-150), outline=(*rgb,alpha), width=width)
    for i in range(16):
        a=2*math.pi*i/16
        r1,r2=260,470
        gd.line((c+math.cos(a)*r1,c+math.sin(a)*r1,
                 c+math.cos(a)*r2,c+math.sin(a)*r2),
                fill=(*rgb,100), width=14)
    glow=glow.filter(ImageFilter.GaussianBlur(18)); im.alpha_composite(glow)
    d=ImageDraw.Draw(im)
    d.ellipse((170,170,s-170,s-170), outline=(245,250,255,235), width=10)
    d.ellipse((225,225,s-225,s-225), outline=(*rgb,220), width=12)
    if name in {"slash","trail","cursed_barrage","black_flash"}:
        d.arc((90,230,s-90,s-130), 205, 345, fill=(255,255,255,245), width=22)
        d.arc((130,270,s-130,s-90), 195, 330, fill=(*rgb,225), width=16)
    if name in {"star","black_flash","red","hollow_purple"}:
        for i in range(12):
            a=2*math.pi*i/12
            rr=455 if i%2==0 else 340
            d.line((c,c,c+math.cos(a)*rr,c+math.sin(a)*rr), fill=(255,255,255,220), width=8)
    im.resize((4096,4096),Image.Resampling.LANCZOS).save(TEX/f"{name}.png", optimize=True)
    (PART/f"vfx_{name}.json").write_text(json.dumps({"textures":[f"jujutsu_neon:vfx/{name}"]},indent=2))

for n in names:
    make_vfx(n, colors[n])

# Item texture.
s=1024
im=Image.new("RGBA",(s,s),(0,0,0,0)); d=ImageDraw.Draw(im)
d.rounded_rectangle((80,340,944,690), radius=120, fill=(10,12,20,255), outline=(60,195,255,255), width=10)
for y in range(370,670,18):
    d.line((120,y,900,y+12), fill=(34,38,52,160), width=4)
d.rounded_rectangle((150,405,874,625), radius=90, fill=(4,5,10,255))
gl=Image.new("RGBA",(s,s),(0,0,0,0)); g=ImageDraw.Draw(gl)
g.rounded_rectangle((130,385,894,645), radius=105, outline=(55,205,255,120), width=28)
gl=gl.filter(ImageFilter.GaussianBlur(25)); im.alpha_composite(gl)
im.resize((4096,4096),Image.Resampling.LANCZOS).save(ITEM/"gojo_blindfold.png", optimize=True)

# Armor layer: transparent black fabric band in helmet area.
armor=Image.new("RGBA",(1024,512),(0,0,0,0)); ad=ImageDraw.Draw(armor)
ad.rectangle((0,0,255,127), fill=(10,12,20,255))
for y in range(12,120,12):
    ad.line((8,y,246,y+4), fill=(45,55,72,145), width=3)
armor.resize((4096,2048),Image.Resampling.LANCZOS).save(ARMOR/"gojo_layer_1.png", optimize=True)

MODEL.joinpath("gojo_blindfold.json").write_text(json.dumps({
    "parent":"minecraft:item/generated",
    "textures":{"layer0":"jujutsu_neon:item/gojo_blindfold"}
}, indent=2))
LANG.joinpath("ru_ru.json").write_text(json.dumps({
    "item.jujutsu_neon.gojo_blindfold":"Повязка Годжо"
}, ensure_ascii=False, indent=2))

sound_names=["blue","max_blue","red","hollow_purple","black_flash","cursed_barrage","domain","infinity","rct","teleport","dash"]
sound_json={n:{"sounds":[f"jujutsu_neon:{n}"]} for n in sound_names}
ROOT.joinpath("sounds.json").write_text(json.dumps(sound_json,indent=2))

# Original synthesized sound design, 48 kHz stereo. Convert WAV -> OGG using ffmpeg.
sr=48000
freqs={
 "blue":190,"max_blue":120,"red":95,"hollow_purple":72,"black_flash":58,
 "cursed_barrage":155,"domain":48,"infinity":310,"rct":440,"teleport":260,"dash":520
}
for idx,n in enumerate(sound_names):
    dur = 1.15 if n in {"domain","hollow_purple","max_blue"} else 0.55
    count=int(sr*dur)
    wav=SOUNDS/f"{n}.wav"
    with wave.open(str(wav),"w") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
        frames=bytearray()
        f=freqs[n]
        for i in range(count):
            t=i/sr
            env=min(1.0,t/0.025)*max(0.0,1.0-t/dur)
            sweep=f*(1.0+0.75*t/dur)
            x=(math.sin(2*math.pi*sweep*t)*0.52 +
               math.sin(2*math.pi*(sweep*2.01)*t)*0.22 +
               math.sin(2*math.pi*(sweep*0.49)*t)*0.16)
            transient=(1.0 if i < sr*0.018 else 0.0)*math.sin(2*math.pi*1700*t)*0.35
            sample=max(-1,min(1,(x+transient)*env))
            val=int(sample*28000)
            frames += struct.pack("<hh",val,val)
        w.writeframes(frames)
    ogg=SOUNDS/f"{n}.ogg"
    subprocess.check_call(["ffmpeg","-loglevel","error","-y","-i",str(wav),"-c:a","libvorbis","-q:a","7",str(ogg)])
    wav.unlink()

print("Generated Jujutsu Neon resources")
