#!/usr/bin/env python3
"""Export an English-first source release without private media or credentials.
Run from the project root: python3 tools/package_submission.py --output /tmp/clearpath-source
The output is a new clean directory, suitable for its own Git repository.
"""
import argparse,hashlib,json,shutil,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FILES=['server.py','registration.py','requirements-vision.txt','LICENSE','.env.example']
DOCS=['architecture.en.md','testing.en.md','ring-setup.en.md','submission-final.md','product-feedback.md','contest-readiness.md','ring-validation_2026-10-14.en.md','ring-integration.png','THIRD_PARTY_NOTICES.md']
IGNORE={'.git','.openai','evidence','recordings','node_modules','__pycache__','.venv-vision','producer-assets'}

def export(target):
    target=target.resolve()
    if target==ROOT or ROOT in target.parents:raise ValueError('Use an output directory outside the project.')
    if target.exists() and any(target.iterdir()):raise ValueError('Output directory must be empty.')
    target.mkdir(parents=True,exist_ok=True)
    for name in FILES:
        source=ROOT/name
        if source.exists():shutil.copy2(source,target/name)
    for directory in ['dist','tests','tools','.github/workflows']:
        for source in (ROOT/directory).rglob('*'):
            if not source.is_file() or source.is_symlink() or any(part in IGNORE for part in source.relative_to(ROOT).parts) or source.suffix in {'.pyc','.log'}:continue
            rel=source.relative_to(ROOT);destination=target/rel;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,destination)
    readme=ROOT/'docs/JUDGE_README.md'
    if not readme.is_file():readme=ROOT/'README.md'
    if not readme.is_file():raise ValueError('English judge README is missing.')
    shutil.copy2(readme,target/'README.md')
    (target/'docs').mkdir(exist_ok=True)
    for name in DOCS:
        source=ROOT/'docs'/name
        if source.is_file():shutil.copy2(source,target/'docs'/name)
    (target/'.gitignore').write_text('__pycache__/\n*.py[cod]\n.venv*/\n.env\n.env.*\n!.env.example\nevidence/\nrecordings/\nnode_modules/\n.DS_Store\n*.log\n*.mov\n*.MOV\n*.webm\n*.mp4\n')
    files=[path for path in target.rglob('*') if path.is_file()]
    for path in files:
        rel=path.relative_to(target)
        if any(part in IGNORE for part in rel.parts) or path.suffix.lower() in {'.mov','.webm','.mp4','.aiff','.wav'}:raise ValueError('Private or binary runtime content in release: '+str(rel))
        if path.suffix in {'.py','.md','.mjs','.html','.css','.txt','.yml'} and str(Path.home()) in path.read_text():raise ValueError('Personal machine path in release: '+str(rel))
    manifest={'project':'ClearPath','scope':'source-only; no private footage, evaluation images, credentials, or local runtime','files':{str(path.relative_to(target)):hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(files)}}
    (target/'SOURCE-MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'output':str(target),'files':len(files)+1}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path);args=p.parse_args();export(args.output)
