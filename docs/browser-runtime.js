/* Browser deployment adapter. Original Dash components, CSS, data and trained trees. */
(function () {
  'use strict';
  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, document.baseURI);
    const file = url.pathname.split('/').pop();
    if (file === '_dash-layout' || file === '_dash-dependencies') {
      return originalFetch(new URL(file === '_dash-layout' ? './layout.json' : './dependencies.json', document.baseURI), init);
    }
    return originalFetch(input, init);
  };
  const ready = Promise.all(['model.json','data.json'].map(f => originalFetch(new URL(f, document.baseURI)).then(r => {
    if (!r.ok) throw new Error('Dashboard asset could not load: ' + f);
    return r.json();
  }))).then(([model,data]) => ({model,data}));
  const f32 = Math.fround;
  function predict(model, names, values) {
    const learner=model.learner;
    let base=learner.learner_model_param.base_score;
    if (typeof base==='string') base=JSON.parse(base);
    let result=f32(Array.isArray(base)?base[0]:base);
    const x=values.map(f32);
    for (const tree of learner.gradient_booster.model.trees) {
      let node=0;
      while (tree.left_children[node] !== -1) {
        const value=x[tree.split_indices[node]];
        node=Number.isNaN(value) ? (tree.default_left[node] ? tree.left_children[node] : tree.right_children[node]) :
          (value < f32(tree.split_conditions[node]) ? tree.left_children[node] : tree.right_children[node]);
      }
      result=f32(result+f32(tree.split_conditions[node]));
    }
    return result;
  }
  function pyRound(value, digits=0) {
    const factor=10**digits, n=value*factor, floor=Math.floor(n), diff=n-floor;
    return (diff===0.5 ? (floor%2===0 ? floor : floor+1) : Math.round(n))/factor;
  }
  const currency=x=>pyRound(x).toLocaleString('en-US',{maximumFractionDigits:0});
  const fixed=(x,n)=>pyRound(x,n).toFixed(n);
  const clone=x=>JSON.parse(JSON.stringify(x));
  function nearest(coords, lat, lon) {
    let best, distance=Infinity;
    for (const [zip, point] of Object.entries(coords)) {
      const d=(point.lat-lat)**2+(point.long-lon)**2;
      if (d<distance) {distance=d;best=Number(zip);}
    }
    return best;
  }
  async function presets(nStd,nLux,nWat,nSub,zip,click,bed,bath,sqft,lot,floors,base,grade,condition,view,wf,lat,lon,year,renov,renovYear,liv15,lot15) {
    const context=window.dash_clientside.callback_context;
    const trigger=context.triggered_id || (context.triggered[0]||{}).prop_id?.split('.')[0];
    const {data}=await ready;
    if (trigger==='preset-standard') return [3,2,1800,5000,'1.5','0','7','3','0','0',98103,47.67,-122.34,1975,'0',0,1800,5000];
    if (trigger==='preset-luxury') return [5,4.5,4800,12000,'2.0','1','11','4','2','0',98004,47.616,-122.205,2008,'0',0,4200,11000];
    if (trigger==='preset-waterfront') return [4,4,4200,16000,'2.0','1','12','4','4','1',98040,47.575,-122.228,1995,'1',2012,3800,15000];
    if (trigger==='preset-suburban') return [3,1.75,1500,8000,'1.0','0','7','3','0','0',98001,47.309,-122.271,1980,'0',0,1600,7800];
    if (trigger==='input-zipcode' && data.zipCoords[zip]) { lat=data.zipCoords[zip].lat; lon=data.zipCoords[zip].long; }
    if (trigger==='main-map' && click) {
      const point=click.points[0]; lat=pyRound(point.lat,4);lon=pyRound(point.lon,4);zip=nearest(data.zipCoords,lat,lon);
    }
    return [bed,bath,sqft,lot,floors,base,grade,condition,view,wf,zip,lat,lon,year,renov,renovYear,liv15,lot15];
  }
  function mapFigure(data,lat,lon,price,maxPrice,waterfrontOnly) {
    const fig=clone(data.mapFigure);
    const rows=data.mapRows.filter(r=>(!waterfrontOnly || r.waterfront===1) && r.price<=maxPrice);
    const trace=fig.data[0];
    trace.lat=rows.map(r=>r.lat);trace.lon=rows.map(r=>r.long);
    trace.hovertext=rows.map(r=>r.price);
    trace.customdata=rows.map(r=>[r.bedrooms,r.bathrooms,r.sqft_living,r.grade,r.zipcode,r.lat,r.long]);
    trace.marker.color=rows.map(r=>r.price);trace.marker.size=rows.map(r=>r.sqft_living);
    // Plotly Express area scaling uses the maximum in the filtered sample.
    trace.marker.sizeref=(rows.length?Math.max(...rows.map(r=>r.sqft_living)):0)/(12**2);
    fig.layout.coloraxis.cmin=data.p1;fig.layout.coloraxis.cmax=Math.min(data.p99,maxPrice);
    fig.layout.map.center={lat,lon};
    for (const t of fig.data.slice(1)) {t.lat=[lat];t.lon=[lon];}
    fig.data[2].hovertext='<b>📍 TARGET PROPERTY</b><br>Valuation: $'+currency(price)+'<br>Lat: '+fixed(lat,4)+', Lon: '+fixed(lon,4);
    return fig;
  }
  async function valuation(n,bed,bath,sqft,lot,floors,basement,grade,condition,view,waterfront,zip,lat,lon,year,renov,renovYear,liv15,lot15,maxPrice,waterfrontOnly) {
    const {model,data}=await ready;
    bed=bed||3;bath=bath||2;sqft=sqft||2000;lot=lot||7500;
    lat=Number(lat||47.67);lon=Number(lon||-122.34);year=Number(year||1985);renov=Number(renov||0);renovYear=Number(renovYear||0);
    const age=Math.max(0,2015-year), since=renov===1 && renovYear>0?Math.max(0,2015-renovYear):age;
    const ratio=sqft/Math.max(1,lot);
    const features={bedrooms:Number(bed),bathrooms:Number(bath),sqft_living:Number(sqft),sqft_lot:Number(lot),floors:Number(floors||1.5),waterfront:Number(waterfront||0),view:Number(view||0),condition:Number(condition||3),grade:Number(grade||7),zipcode:Number(zip||98103),lat,long:lon,sqft_living15:Number(liv15||sqft||2000),sqft_lot15:Number(lot15||lot||7500),has_basement:Number(basement||0),sale_year:2015,sale_month:6,house_age:age,is_renovated:renov,years_since_renovation:since,living_to_lot_ratio:ratio};
    const log=predict(model,data.features,data.features.map(k=>features[k]));
    const price=f32(Math.expm1(log));
    const [tier,color]=price<350000?['Affordable Starter / Suburban','success']:price<650000?['Mid-Market Residential','primary']:price<1200000?['Premium / Upper-Tier Executive','warning']:['Luxury & Waterfront Estate','danger'];
    return ['$'+currency(price),'Confidence Range: $'+currency(Math.max(50000,price-64599.45))+' - $'+currency(price+64599.45)+' (+/- $64.6k MAE)',tier,'badge bg-'+color+' text-white fw-bold px-3 py-1','$'+fixed(price/Math.max(1,sqft),2),fixed(ratio,2),age+' Years',renov?'Yes ('+since+' yrs ago)':'Original (None)',mapFigure(data,lat,lon,price,Number(maxPrice||2500000),!!waterfrontOnly?.length)];
  }
  window.dash_clientside=Object.assign({},window.dash_clientside,{kingCounty:{presets,valuation}});
  // Export the pure evaluator for verification against the original Python model.
  window.kingCountyModel={predict,ready};
})();
