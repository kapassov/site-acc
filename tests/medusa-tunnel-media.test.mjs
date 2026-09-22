import test from 'node:test';
import assert from 'node:assert/strict';
test('existing Medusa photos keep HTTPS storefront proxy after API moves to loopback',async()=>{
  const prior=process.env.MEDUSA_URL;process.env.MEDUSA_URL='http://127.0.0.1:19000';
  try{
    const {medusaMediaUrl}=await import('../src/lib/media-url.ts?private-tunnel-test');
    assert.equal(medusaMediaUrl('http://78.140.246.238:9000/static/product.webp'),'/api/media/medusa?path=%2Fstatic%2Fproduct.webp');
    assert.equal(medusaMediaUrl('/static/local.webp'),'/api/media/medusa?path=%2Fstatic%2Flocal.webp');
    assert.equal(medusaMediaUrl('https://unrelated.test/static/file.webp'),'https://unrelated.test/static/file.webp');
    assert.equal(medusaMediaUrl('http://78.140.246.238:9000/admin'),'http://78.140.246.238:9000/admin');
  }finally{if(prior===undefined) delete process.env.MEDUSA_URL; else process.env.MEDUSA_URL=prior;}
});
