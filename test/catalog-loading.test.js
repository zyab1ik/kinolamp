'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../web/static/kp');
const {harness} = require('./support/lampa');
const rows = (start, count = 20) => Array.from({length:count}, (_, n) => ({key:'item:'+(start+n),title:'Film '+(start+n),subtitle:'2026'}));
function setup(data) {
  const h = harness({native:true});
  let loads = 0;
  const pages = plugin.createNativePages(h.Lampa, h.$, h.navigation, (route, done) => {
    loads++;
    done(null, route.kp_view === 'item' ? {title:'Film',rows:[]} : data);
  }, () => pages.show({view:'item',id:1}));
  pages.show({view:'catalog'});
  return {h,pages,loads:()=>loads,end:()=>h.scrolls.at(-1).onEnd()};
}

test('TV focus prefetches once, appends unique cards and retains focus and Back history', () => {
  let calls=0, finish;
  const state=setup({title:'Catalog',rows:rows(1),more(done){calls++; finish=done;}});
  const {h,end}=state;
  const page=h.pages[0], scroll=h.scrolls[0];
  h.pageCards()[0].handlers['hover:focus'](); assert.equal(calls,0);
  const anchor=h.pageCards()[15]; anchor.handlers['hover:focus']();
  assert.equal(calls,1); end(); end(); assert.equal(calls,1);
  const first=h.pageCards()[0]; finish(null,{rows:rows(20,21)});
  assert.equal(h.pageCards().length,40); assert.equal(h.pageCards()[0],first); assert.equal(h.focus,anchor);
  assert.equal(h.pageActions().length,0); assert.equal(h.routes.length,1);
  h.openCard(0); assert.equal(h.pages.length,2);
  scroll.onEnd(); assert.equal(calls,1,'suspended page never loads');
  h.Lampa.Activity.backward(); assert.equal(h.pages[0],page); assert.equal(h.pageCards().length,40);
  assert.equal(state.loads(),2); assert.equal(h.focus,anchor); end(); assert.equal(calls,1);
});

test('loading errors retain cards and need an explicit retry without an automatic retry loop', () => {
  let calls=0, finish;
  const {h,end}=setup({title:'Catalog',rows:rows(1),more(done){calls++; finish=done;}});
  const anchor=h.pageCards()[4]; anchor.handlers['hover:focus'](); end();
  finish('Network failure https://private.example');
  assert.equal(h.pageCards().length,20); assert.equal(h.focus,anchor);
  end(); end(); assert.equal(calls,1);
  const retry=h.pageActions().find(n=>n.value==='Повторить');
  retry.handlers['hover:focus'](); end(); assert.equal(calls,1);
  h.pageAction('Повторить'); assert.equal(calls,2); end(); assert.equal(calls,2);
  finish(null,{rows:rows(21)}); assert.equal(h.pageCards().length,40); assert.equal(h.focus,anchor);
  assert.equal(h.pageActions().length,0);
  assert.equal(h.nodes.some(n=>String(n.value).includes('private.example')),false);
});

test('late results are discarded on pause, resume, refresh and destruction', () => {
  for (const mode of ['paused','resumed','refresh','destroy']) {
    let calls=0; const pending=[];
    const {h,end}=setup({title:'Catalog',rows:rows(1),more(done){calls++;pending.push(done);}});
    const page=h.pages[0], scroll=h.scrolls[0]; end();
    if(mode==='destroy') h.Lampa.Activity.backward();
    else if(mode==='refresh') page.create();
    else {page.pause(); if(mode==='resumed') page.start();}
    pending[0](null,{rows:rows(21)});
    if(mode==='destroy') {scroll.onEnd();assert.equal(calls,1);continue;}
    assert.equal(h.pageCards().length,20);
    if(mode==='paused') page.start();
    end(); assert.equal(calls,2); pending[1](null,{rows:rows(21)});
    assert.equal(h.pageCards().length,40);
  }
});

test('empty, repeated and exhausted pages stop loading; account changes reject pending data', () => {
  for (const returned of [[],rows(1)]) {
    let next=0;
    const {h,end}=setup({title:'Catalog',rows:rows(1),more(done){done(null,{rows:returned,more(){next++;}});}});
    end();end();assert.equal(next,0);assert.equal(h.pageCards().length,20);
  }
  let stale=false, finish, calls=0;
  const {h,end}=setup({title:'Catalog',rows:rows(1),isStale(){return stale;},more(done){calls++;finish=done;}});
  end();stale=true;finish(null,{rows:rows(21)});end();
  assert.equal(h.pageCards().length,20);assert.equal(calls,1);
  const empty=setup({title:'Empty',rows:[],more(){assert.fail('no loading from an empty first page');}});empty.end();
});
