#!/usr/bin/env python3
"""Verify the pinned OCI manifest, config and every archived blob without extraction."""
import argparse, hashlib, json, pathlib, re, tarfile

def verify(archive, inspect_file, revision, config_digest, manifest_digest):
    documents, blobs, count = {}, {}, 0
    with tarfile.open(archive, 'r|gz') as tf:
        for member in tf:
            if member.isdir():
                if member.name not in ['blobs', 'blobs/sha256']: raise ValueError('IMAGE_ARCHIVE_DIRECTORY_REJECTED')
                continue
            if not member.isfile(): raise ValueError('IMAGE_ARCHIVE_TYPE_REJECTED')
            name = member.name
            if name not in ['index.json', 'manifest.json', 'oci-layout', 'repositories'] and not re.fullmatch(r'blobs/sha256/[a-f0-9]{64}', name): raise ValueError('IMAGE_ARCHIVE_PATH_REJECTED')
            if name in blobs: raise ValueError('IMAGE_ARCHIVE_DUPLICATE')
            stream, digest, data = tf.extractfile(member), hashlib.sha256(), bytearray()
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk: break
                digest.update(chunk)
                if member.size <= 1024 * 1024: data.extend(chunk)
            actual = 'sha256:' + digest.hexdigest()
            if name.startswith('blobs/sha256/') and actual != 'sha256:' + name.rsplit('/', 1)[1]: raise ValueError('IMAGE_BLOB_DIGEST_MISMATCH')
            blobs[name] = (actual, member.size)
            if data:
                try: documents[name] = json.loads(data)
                except (ValueError, UnicodeDecodeError): pass
            count += 1
    def blob(digest): return 'blobs/sha256/' + digest.split(':', 1)[1]
    def descriptor(desc, expected):
        if desc.get('digest') != expected or blobs.get(blob(expected)) != (expected, desc.get('size')): raise ValueError('IMAGE_DESCRIPTOR_MISMATCH')
    index = documents['index.json']
    if index.get('schemaVersion') != 2 or len(index.get('manifests', [])) != 1: raise ValueError('IMAGE_INDEX_REJECTED')
    descriptor(index['manifests'][0], manifest_digest)
    if index['manifests'][0].get('annotations', {}).get('org.opencontainers.image.ref.name') != revision: raise ValueError('IMAGE_TAG_REJECTED')
    manifest = documents[blob(manifest_digest)]
    if manifest.get('schemaVersion') != 2: raise ValueError('IMAGE_MANIFEST_REJECTED')
    descriptor(manifest['config'], config_digest)
    for layer in manifest['layers']: descriptor(layer, layer['digest'])
    config = documents[blob(config_digest)]
    ci = json.loads(pathlib.Path(inspect_file).read_text())[0]
    if ci.get('Id') != config_digest or ci.get('Architecture') != 'arm64' or config.get('architecture') != 'arm64' or config.get('os') != 'linux' or config.get('config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != revision: raise ValueError('IMAGE_CONFIG_IDENTITY_REJECTED')
    if ci.get('RootFS') != {'Type':config['rootfs']['type'], 'Layers':config['rootfs']['diff_ids']}: raise ValueError('IMAGE_ROOTFS_MISMATCH')
    if len(manifest['layers']) != len(config['rootfs']['diff_ids']): raise ValueError('IMAGE_LAYER_COUNT_MISMATCH')
    return {'schema':'oracle-image-identity.v1','status':'PASS','configDigest':config_digest,'manifestDigest':manifest_digest,'revision':revision,'architecture':'arm64','layersVerified':len(manifest['layers']),'archiveEntriesVerified':count,'rootFsMatchesCi':True,'writes':0}

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    for name in ['archive', 'inspect', 'revision', 'config-digest', 'manifest-digest']: p.add_argument('--'+name, required=True)
    a = p.parse_args()
    try: print(json.dumps(verify(a.archive, a.inspect, a.revision, a.config_digest, a.manifest_digest)))
    except (ValueError, KeyError, OSError, tarfile.TarError) as e:
        code = str(e) if re.fullmatch('[A-Z_]+', str(e)) else 'IMAGE_GRAPH_VERIFICATION_FAILED'
        print(json.dumps({'status':'BLOCKED','code':code,'writes':0})); raise SystemExit(2)
