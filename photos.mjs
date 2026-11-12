import {IMAGE_LIMITS} from './core.mjs';
export async function preparePhoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Выберите фото JPG, PNG или WebP.');
  if(file.size>20*1024*1024)throw new Error('Исходный файл должен быть меньше 20 МБ.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const scale=Math.min(1,IMAGE_LIMITS.maxDimension/Math.max(image.naturalWidth,image.naturalHeight));
    const width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Не удалось подготовить фото.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.86));
    if(!blob||blob.size>IMAGE_LIMITS.maxBytes)throw new Error('Фото слишком большое после сжатия. Выберите файл меньшего размера.');
    return {blob,width,height,name:file.name.slice(0,200)};
  }finally{URL.revokeObjectURL(url);}
}
