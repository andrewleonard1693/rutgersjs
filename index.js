const   request   =     require('request'),
        x2j       =     require('xml2js'),
        parser    =     new x2j.Parser({mergeAttrs: true})

//api endpoints
const predictionUrl     =   'http://webservices.nextbus.com/service/publicXMLFeed?command=predictions&a=rutgers&r=<routeTag>&s=<stopTag>'
const routeConfigUrl    =   'http://webservices.nextbus.com/service/publicXMLFeed?a=rutgers&command=routeConfig'
const routeListUrl      =   'http://webservices.nextbus.com/service/publicXMLFeed?a=rutgers&command=routeList'


//returns the rutgers route list
exports.getRouteList = function(){
    return new Promise((resolve, reject)=> {
        getRouteList(routeListUrl).then(function(routeList){
            resolve(routeList.body.route);
        }).catch(err=>reject(err))
    })
}
//Returns all stops for a specific route
exports.getStopsOnRoute = function(routeTitle){
    return new Promise((resolve, reject)=>{
        getRouteConfig(routeConfigUrl).then(function(parsed){
            var routes = parsed.body.route;
            var stops = [];
            routes.forEach(route=>{
                if(route.title[0]===routeTitle){
                    //route found
                    let stop = route.stop;
                    stop.forEach(element => {
                        stops.push({
                            tag: element.tag[0],
                            title: element.title[0],
                            lat: Number(element.lat[0]),
                            lon: Number(element.lon[0])
                        });
                    })
                    resolve({
                        routeTitle: routeTitle,
                        routeTag: route.tag[0],
                        stops: stops
                    });
                }
            })
            //route title not found
            reject("The route you requested does not exist. Please refer to the documentation to make sure you entered your route title correctly.")
        })
    })
}
//Function to get route predictions for a specific route
//Returns a promise with the title of the stop and the minutes or seconds eta
exports.getRoutePredictions = function(routeTitle){
    return new Promise((resolve,reject)=>{
        exports.getStopsOnRoute(routeTitle)
        .then(async function(result){
            let requestPromises = [];
            let parsedPromises = [];
            let predictions = [];
            var stops = result.stops;
            for(var i = 0; i<stops.length;i++){
                let url = predictionUrl.replace("<routeTag>",result.routeTag)
                url = url.replace("<stopTag>",stops[i].tag);
                let promise = doRequest(url);
                requestPromises.push(promise);
            }

            let requestResults;
            await Promise.all(requestPromises).then(function(result){
                requestResults = result;
            }).catch(err => reject(err));

            requestResults.forEach(element => {
                let parsedPromise = parseRequest(element);
                parsedPromises.push(parsedPromise)
            })

            let parsed;
            await Promise.all(parsedPromises).then(function(result){
                parsed = result;
            }).catch(err => reject(err));
            parsed.forEach(element => {
                let minutes = [];
                let seconds = [];
                let stopTitle = element.body.predictions[0].stopTitle[0];

                if(!element.body.predictions[0].dirTitleBecauseNoPredictions){
                    let dir = element.body.predictions[0].direction[0].title[0]
                    let pred = element.body.predictions[0].direction[0].prediction;
                    let ob = []
                    pred.forEach(element => {
                        ob.push({
                            minutes: element.minutes[0],
                            seconds: element.seconds[0]
                        })
                    });
                    predictions.push({
                        title: stopTitle,
                        direction:dir,
                        predictionAvailable:true,
                        predictions: ob
                    })
                }
                else{
                    predictions.push({
                        title: stopTitle,
                        predictions: null,
                        predictionAvailable: false
                    })
                }
            })
            resolve({
                routeTitle: result.routeTitle,
                routeTag: result.routeTag,
                predictions: predictions
            });
        })
        .catch(err => reject(err));
    })
}

//Gets the location of a specific stop including title, latitude, and logitude
exports.getStop = function(stopTitle){
    return new Promise((resolve, reject)=>{
        getRouteConfig(routeConfigUrl).then(function(parsed){
            let routes = parsed.body.route;
            routes.forEach(route=>{
                let stops = route.stop;
                stops.forEach(stop => {
                    if(stop.title[0] === stopTitle){
                        resolve({
                            tag: stop.tag[0],
                            title: stopTitle,
                            lat: Number(stop.lat[0]),
                            lon: Number(stop.lon[0])
                        })
                    }
                })
            })
            reject("The stop you specified does not exist. Please refer to the wiki for valid stop titles.")
        }).catch(err => console.log(err));
    })
}


//Gets the locations of all stops
exports.getAllStops = function(){
    return new Promise((resolve, reject)=>{
        getRouteConfig(routeConfigUrl).then(function(parsed){
            let routes = parsed.body.route
            var stopObjects = []
            routes.forEach(route => {
                let stops = route.stop;
                var present = false;
                stops.forEach(stop => {
                   stopObjects.forEach(element => {
                       if(element.title === stop.title[0] && element.tag === stop.tag[0]){
                           present = true
                       }
                   })
                   if(!present){
                       stopObjects.push({
                           tag: stop.tag[0],
                           title: stop.title[0],
                           lat: Number(stop.lat[0]),
                           lon: Number(stop.lon[0])

                       })
                   }else{
                       present = false
                   }
                })
            })
            resolve(stopObjects)
        }).catch(err => reject(err));
    });
}
//get predictions for a specific stop for all routes 
exports.getStopPredictions =  function(stopTitle){
    return new Promise((resolve, reject) => {
        getRouteConfig(routeConfigUrl).then(async function(parsed){
            let routes = parsed.body.route
            let ret = []
            let routePredictionPromises = []
            var routePredictionResult
            routes.forEach( function(route) {
                let routePromise = exports.getRoutePredictions(route.title[0])
                routePredictionPromises.push(routePromise)

            })
            await Promise.all(routePredictionPromises).then(function(result){
                routePredictionResult = result
            })
            for(var i = 0;i<routePredictionResult.length;i++){
                let predictions = routePredictionResult[i].predictions
                predictions.forEach(pred => {
                    if(pred.title === stopTitle && pred.predictionAvailable === true){
                        ret.push({
                            routeTitle: routePredictionResult[i].routeTitle,
                            routeTag: routePredictionResult[i].routeTag,
                            prediction: pred
                            
                        })
                    }
                })
                
            }
            if(ret.length == 0){
                reject("There doesn't seem to be any predictions for that stop at this time")
            }else{
                resolve(ret)
            }
        }).catch(err => reject(err))

    })
}



//============================
//UTILITY FUNCTIONS
//============================
function doRequest(url){
    return new Promise((resolve, reject)=>{
        request(url, (err, res, body) => {
            if(err){ reject(err)};
            resolve(body);
    
        });
    })
}
function parseRequest(body){
    return new Promise((resolve, reject)=>{
        parser.parseString(body, function(err, result){
            if(err){reject(err)};
            var routes = JSON.parse(JSON.stringify(result,undefined,3));
            resolve(routes);
        })
    })
}
function getRouteList(url){
    return new Promise((resolve,reject)=>{
        doRequest(url).then(function(response){
            parseRequest(response).then(function(parsed){
                resolve(parsed);
            }).catch(err => reject(err))
        }).catch(err => reject(err));
    })
}

function getRouteConfig(url){
    return new Promise((resolve,reject)=>{
        doRequest(url).then(function(response){
            parseRequest(response).then(function(parsed){
                resolve(parsed);
            }).catch(err => reject(err))
        }).catch(err => reject(err));

    })
}