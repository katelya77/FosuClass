"use strict";
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const fail=code=>Object.assign(new Error(code),{code});
const fileFor=cfg=>path.join(cfg.dataRoot,'school-credentials.json');
function parent(cfg,platform=process.platform){
  const file=path.resolve(fileFor(cfg)),directory=path.dirname(file),snapshots=[];
  let current=directory;
  for(;;){
    const stat=fs.lstatSync(current);
    if(!stat.isDirectory()||stat.isSymbolicLink()||platform!=='win32'&&(stat.uid!==0||
      (current===directory?(stat.mode&0o7777)!==0o700:(stat.mode&0o022)!==0&&!(stat.mode&0o1000))))throw fail('SCHOOL_CREDENTIALS_PERMISSIONS_REJECTED');
    snapshots.push([current,stat.dev,stat.ino]);const next=path.dirname(current);if(next===current)break;current=next;
  }
  return {file,snapshots};
}
function regular(stat,platform){
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384||platform!=='win32'&&(stat.uid!==0||(stat.mode&0o7777)!==0o600))throw fail('SCHOOL_CREDENTIALS_PERMISSIONS_REJECTED');
}
function unchanged(before,cfg,platform){
  const after=parent(cfg,platform);if(JSON.stringify(before.snapshots)!==JSON.stringify(after.snapshots))throw fail('SCHOOL_CREDENTIALS_PERMISSIONS_REJECTED');
}
function validate(value){
  if(!value||Array.isArray(value)||value.schema!==1||value.recoveryEnabled!==false||Object.keys(value).length!==4||
    Object.keys(value).some(key=>!['schema','account','password','recoveryEnabled'].includes(key))||
    typeof value.account!=='string'||!value.account||value.account!==value.account.trim()||value.account.length>64||/[\s\x00-\x1f]/.test(value.account)||
    typeof value.password!=='string'||!value.password||value.password.length>1024||/[\x00\r\n]/.test(value.password))throw fail('SCHOOL_CREDENTIALS_FORMAT_REJECTED');
  return value;
}
function available(cfg,platform=process.platform){
  try{const before=parent(cfg,platform);regular(fs.lstatSync(before.file),platform);return before;}
  catch(error){throw fail(error.code?.startsWith('SCHOOL_CREDENTIALS_')?error.code:'SCHOOL_CREDENTIALS_FILE_REQUIRED');}
}
function read(cfg,platform=process.platform){
  let fd,buffer,value;
  try{
    const before=available(cfg,platform),original=fs.lstatSync(before.file);
    fd=fs.openSync(before.file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
    const stat=fs.fstatSync(fd);regular(stat,platform);
    if(stat.dev!==original.dev||stat.ino!==original.ino)throw fail('SCHOOL_CREDENTIALS_PERMISSIONS_REJECTED');
    buffer=fs.readFileSync(fd);if(buffer.length>16384)throw fail('SCHOOL_CREDENTIALS_FORMAT_REJECTED');
    value=validate(JSON.parse(buffer.toString('utf8')));unchanged(before,cfg,platform);
    return value;
  }catch(error){if(value){value.account='';value.password='';}throw fail(error.code?.startsWith('SCHOOL_CREDENTIALS_')?error.code:'SCHOOL_CREDENTIALS_FORMAT_REJECTED');}
  finally{if(buffer)buffer.fill(0);if(fd!==undefined)fs.closeSync(fd);}
}
function write(cfg,credentials,platform=process.platform){
  let fd,temp,buffer;
  try{
    const before=parent(cfg,platform),value=validate({schema:1,account:credentials.account,password:credentials.password,recoveryEnabled:false});
    let original;try{original=fs.lstatSync(before.file);regular(original,platform);}catch(error){if(error.code!=='ENOENT')throw error;}
    temp=before.file+'.'+process.pid+'.'+crypto.randomBytes(8).toString('hex')+'.pending';
    fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
    regular(fs.fstatSync(fd),platform);buffer=Buffer.from(JSON.stringify(value)+'\n');fs.writeFileSync(fd,buffer);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    unchanged(before,cfg,platform);
    let current;try{current=fs.lstatSync(before.file);regular(current,platform);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(Boolean(current)!==Boolean(original)||current&&(current.dev!==original.dev||current.ino!==original.ino))throw fail('SCHOOL_CREDENTIALS_PERMISSIONS_REJECTED');
    fs.renameSync(temp,before.file);temp=undefined;
    if(platform!=='win32'){const directory=fs.openSync(path.dirname(before.file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
    return {status:'SCHOOL_CREDENTIALS_CONFIGURED',credentialSource:'protected-file',recoveryEnabled:false,schoolRequests:0,passwordSubmissions:0};
  }catch(error){throw fail(error.code?.startsWith('SCHOOL_CREDENTIALS_')?error.code:'SCHOOL_CREDENTIALS_WRITE_FAILED');}
  finally{if(buffer)buffer.fill(0);if(fd!==undefined)fs.closeSync(fd);if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);}
}
module.exports={fileFor,available,read,write};
