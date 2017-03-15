/* jshint maxcomplexity: false */
'use strict';
const svgjs = require('svg.js');
const shared = require('./shared.js')();

// Functions for turning ESRI Renderers into images
// Specifically, converting ESRI "Simple" symbols into images,
// and deriving the appropriate image for a feature based on
// a renderer

// layer symbology types
const SIMPLE = 'simple';
const UNIQUE_VALUE = 'uniqueValue';
const CLASS_BREAKS = 'classBreaks';

const CONTAINER_SIZE = 32; // size of the symbology item container
const CONTENT_SIZE = 24; // size of the symbology graphic
const CONTENT_IMAGE_SIZE = 28; // size of the symbology graphic if it's an image (images tend to already have a white boarder around them)
const CONTAINER_CENTER = CONTAINER_SIZE / 2;
const CONTENT_PADDING = (CONTAINER_SIZE - CONTENT_SIZE) / 2;

/**
* Will add extra properties to a renderer to support images.
* New properties .svgcode and .defaultsvgcode contains image source
* for app on each renderer item.
*
* @param {Object} renderer an ESRI renderer object in server JSON form. Param is modified in place
* @param {Object} legend object for the layer that maps legend label to data url of legend image
* @return {Promise} resolving when the renderer has been enhanced
*/
function enhanceRenderer(renderer, legend) {

    // TODO note somewhere (user docs) that everything fails if someone publishes a legend with two identical labels

    // quick lookup object of legend names to data URLs.
    // our legend object is in ESRI format, but was generated by us and only has info for a single layer.
    // so we just grab item 0, which is the only item.
    const legendLookup = {};

    // store svgcode in the lookup
    const legendItemPromises = legend.layers[0].legend.map(legItem =>
        legItem.then(data =>
            legendLookup[data.label] = data.svgcode
        ));

    // wait until all legend items are resolved and legend lookup is updated
    return Promise.all(legendItemPromises).then(() => {
        switch (renderer.type) {
            case SIMPLE:
                renderer.svgcode = legendLookup[renderer.label];
                break;

            case UNIQUE_VALUE:
                if (renderer.defaultLabel) {
                    renderer.defaultsvgcode = legendLookup[renderer.defaultLabel];
                }

                renderer.uniqueValueInfos.forEach(uvi => {
                    uvi.svgcode = legendLookup[uvi.label];
                });

                break;
            case CLASS_BREAKS:
                if (renderer.defaultLabel) {
                    renderer.defaultsvgcode = legendLookup[renderer.defaultLabel];
                }

                renderer.classBreakInfos.forEach(cbi => {
                    cbi.svgcode = legendLookup[cbi.label];
                });

                break;
            default:

                // Renderer we dont support
                console.warn('encountered unsupported renderer type: ' + renderer.type);
        }
    });
}

/**
* Given feature attributes, find the renderer node that would draw it
*
* @method searchRenderer
* @param {Object} attributes object of feature attribute key value pairs
* @param {Object} renderer an enhanced renderer (see function enhanceRenderer)
* @return {Object} an Object with svgcode and symbol properties for the matched renderer item
*/
function searchRenderer(attributes, renderer) {

    let svgcode;
    let symbol = {};

    switch (renderer.type) {
        case SIMPLE:
            svgcode = renderer.svgcode;
            symbol = renderer.symbol;

            break;

        case UNIQUE_VALUE:

            // make a key value for the graphic in question, using comma-space delimiter if multiple fields
            // put an empty string when key value is null
            let graphicKey = attributes[renderer.field1] === null ? '' : attributes[renderer.field1];

            // all key values are stored as strings.  if the attribute is in a numeric column, we must convert it to a string to ensure the === operator still works.
            if (typeof graphicKey !== 'string') {
                graphicKey = graphicKey.toString();
            }

            if (renderer.field2) {
                graphicKey = graphicKey + ', ' + attributes[renderer.field2];
                if (renderer.field3) {
                    graphicKey = graphicKey + ', ' + attributes[renderer.field3];
                }
            }

            // search the value maps for a matching entry.  if no match found, use the default image
            const uvi = renderer.uniqueValueInfos.find(uvi => uvi.value === graphicKey);
            if (uvi) {
                svgcode = uvi.svgcode;
                symbol = uvi.symbol;
            } else {
                svgcode = renderer.defaultsvgcode;
                symbol = renderer.defaultSymbol;
            }

            break;

        case CLASS_BREAKS:

            const gVal = parseFloat(attributes[renderer.field]);
            const lower = renderer.minValue;

            svgcode = renderer.defaultsvgcode;
            symbol = renderer.defaultSymbol;

            // check for outside range on the low end
            if (gVal < lower) { break; }

            // array of minimum values of the ranges in the renderer
            let minSplits = renderer.classBreakInfos.map(cbi => cbi.classMaxValue);
            minSplits.splice(0, 0, lower - 1); // put lower-1 at the start of the array and shift all other entries by 1

            // attempt to find the range our gVal belongs in
            const cbi = renderer.classBreakInfos.find((cbi, index) => gVal > minSplits[index] &&
                gVal <= cbi.classMaxValue);
            if (!cbi) { // outside of range on the high end
                break;
            }
            svgcode = cbi.svgcode;
            symbol = cbi.symbol;

            break;

        default:

            // TODO set svgcode to blank image?
            console.warn(`Unknown renderer type encountered - ${renderer.type}`);

    }

    // make an empty svg graphic in case nothing is found to avoid undefined inside the filters
    if (typeof svgcode === 'undefined') {
        svgcode = svgjs(document.createElement('div')).size(CONTAINER_SIZE, CONTAINER_SIZE).svg();
    }

    return { svgcode, symbol };

}

/**
* Given feature attributes, return the image URL for that feature/graphic object.
*
* @method getGraphicIcon
* @param {Object} attributes object of feature attribute key value pairs
* @param {Object} renderer an enhanced renderer (see function enhanceRenderer)
* @return {String} svgcode Url to the features symbology image
*/
function getGraphicIcon(attributes, renderer) {
    const renderInfo = searchRenderer(attributes, renderer);
    return renderInfo.svgcode;
}

/**
* Given feature attributes, return the symbol for that feature/graphic object.
*
* @method getGraphicSymbol
* @param {Object} attributes object of feature attribute key value pairs
* @param {Object} renderer an enhanced renderer (see function enhanceRenderer)
* @return {Object} an ESRI Symbol object in server format
*/
function getGraphicSymbol(attributes, renderer) {
    const renderInfo = searchRenderer(attributes, renderer);
    return renderInfo.symbol;
}

/**
 * Generates svg symbology for WMS layers.
 * @function generateWMSSymbology
 * @param {String} name label for the symbology item (it's not used right now, but is required to be consistent with other symbology generating functions)
 * @param {String} imageUri url or dataUrl of the legend image
 * @return {Promise} a promise resolving with symbology svg code and its label
 */
function generateWMSSymbology(name, imageUri) {
    const draw = svgjs(window.document.createElement('div'))
        .size(CONTAINER_SIZE, CONTAINER_SIZE)
        .viewbox(0, 0, 0, 0);

    const symbologyItem = {
        name,
        svgcode: null
    };

    if (imageUri) {

        const symbologyPromise = shared.convertImagetoDataURL(imageUri)
            .then(imageUri =>
                svgDrawImage(draw, imageUri))
            .then(({ loader }) => {
                draw.viewbox(0, 0, loader.width, loader.height);
                symbologyItem.svgcode = draw.svg();

                return symbologyItem;
            })
            .catch(err => {
                console.error('Cannot draw wms legend image; returning empty', err);
                symbologyItem.svgcode = draw.svg();
            });

        return symbologyPromise;
    } else {
        symbologyItem.svgcode = draw.svg();
        return Promise.resolve(symbologyItem);
    }
}

/**
 * Generates a placeholder symbology graphic. Returns a promise for consistency
 * @function generatePlaceholderSymbology
 * @private
 * @param  {String} name label symbology label
 * @param  {String} colour colour to use in the graphic
 * @return {Promise}       promise resolving with symbology svg code and its label
 */
function generatePlaceholderSymbology(name, colour = '#000') {
    const draw = svgjs(window.document.createElement('div'))
        .size(CONTAINER_SIZE, CONTAINER_SIZE)
        .viewbox(0, 0, CONTAINER_SIZE, CONTAINER_SIZE);

    draw.rect(CONTENT_IMAGE_SIZE, CONTENT_IMAGE_SIZE)
        .center(CONTAINER_CENTER, CONTAINER_CENTER)
        .fill(colour);

    draw
        .text(name[0].toUpperCase()) // take the first letter
        .size(23)
        .fill('#fff')
        .attr({
            'font-weight': 'bold',
            'font-family': 'Roboto'
        })
        .center(CONTAINER_CENTER, CONTAINER_CENTER);

    return Promise.resolve({
        name,
        svgcode: draw.svg()
    });
}

/**
* Generate a legend item for an ESRI symbol.
* @private
* @param  {Object} symbol an ESRI symbol object in server format
* @param  {String} label label of the legend item
* @param  {Object} window reference to the browser window
* @return {Object} a legend object populated with the symbol and label
*/
function symbolToLegend(symbol, label, window) {
    // create a temporary svg element and add it to the page; if not added, the element's bounding box cannot be calculated correctly
    const container = window.document.createElement('div');
    container.setAttribute('style', 'opacity:0;position:fixed;left:100%;top:100%;overflow:hidden');
    window.document.body.appendChild(container);

    const draw = svgjs(container)
        .size(CONTAINER_SIZE, CONTAINER_SIZE)
        .viewbox(0, 0, CONTAINER_SIZE, CONTAINER_SIZE);

    // functions to draw esri simple marker symbols
    // jscs doesn't like enhanced object notation
    // jscs:disable requireSpacesInAnonymousFunctionExpression
    const esriSimpleMarkerSimbol = {
        esriSMSPath({ size, path }) {
            return draw.path(path).size(size);
        },
        esriSMSCircle({ size }) {
            return draw.circle(size);
        },
        esriSMSCross({ size }) {
            return draw.path('M 0,10 L 20,10 M 10,0 L 10,20').size(size);
        },
        esriSMSX({ size }) {
            return draw.path('M 0,0 L 20,20 M 20,0 L 0,20').size(size);
        },
        esriSMSTriangle({ size }) {
            return draw.path('M 20,20 L 10,0 0,20 Z').size(size);
        },
        esriSMSDiamond({ size }) {
            return draw.path('M 20,10 L 10,0 0,10 10,20 Z').size(size);
        },
        esriSMSSquare({ size }) {
            return draw.path('M 0,0 20,0 20,20 0,20 Z').size(size);
        }
    };

    // jscs:enable requireSpacesInAnonymousFunctionExpression

    // line dash styles
    const ESRI_DASH_MAPS = {
        esriSLSSolid: 'none',
        esriSLSDash: '5.333,4',
        esriSLSDashDot: '5.333,4,1.333,4',
        esriSLSLongDashDotDot: '10.666,4,1.333,4,1.333,4',
        esriSLSDot: '1.333,4',
        esriSLSLongDash: '10.666,4',
        esriSLSLongDashDot: '10.666,4,1.333,4',
        esriSLSShortDash: '5.333,1.333',
        esriSLSShortDashDot: '5.333,1.333,1.333,1.333',
        esriSLSShortDashDotDot: '5.333,1.333,1.333,1.333,1.333,1.333',
        esriSLSShortDot: '1.333,1.333',
        esriSLSNull: 'none'
    };

    // default stroke style
    const DEFAULT_STROKE = {
        color: '#000',
        opacity: 1,
        width: 1,
        linecap: 'square',
        linejoin: 'miter',
        miterlimit: 4
    };

    // this is a null outline in case a supplied symbol doesn't have one
    const DEFAULT_OUTLINE = {
        color: [0, 0, 0, 0],
        width: 0,
        style: ESRI_DASH_MAPS.esriSLSNull
    };

    // 5x5 px patter with coloured diagonal lines
    const esriSFSFills = {
        esriSFSSolid: symbolColour => {
            return {
                color: symbolColour.colour,
                opacity: symbolColour.opacity
            };
        },
        esriSFSNull: () => 'transparent',
        esriSFSHorizontal: (symbolColour, symbolStroke) => {
            const cellSize = 5;

            // patter fill: horizonal line in a 5x5 px square
            return draw.pattern(cellSize, cellSize, add =>
                add.line(0, cellSize / 2, cellSize, cellSize / 2)).stroke(symbolStroke);
        },
        esriSFSVertical: (symbolColour, symbolStroke) => {
            const cellSize = 5;

            // patter fill: vertical line in a 5x5 px square
            return draw.pattern(cellSize, cellSize, add =>
                add.line(cellSize / 2, 0, cellSize / 2, cellSize)).stroke(symbolStroke);
        },
        esriSFSForwardDiagonal: (symbolColour, symbolStroke) => {
            const cellSize = 5;

            // patter fill: forward diagonal line in a 5x5 px square; two more diagonal lines offset to cover the corners when the main line is cut off
            return draw.pattern(cellSize, cellSize, add => {
                add.line(0, 0, cellSize, cellSize).stroke(symbolStroke);
                add.line(0, 0, cellSize, cellSize).move(0, cellSize).stroke(symbolStroke);
                add.line(0, 0, cellSize, cellSize).move(cellSize, 0).stroke(symbolStroke);
            });
        },
        esriSFSBackwardDiagonal: (symbolColour, symbolStroke) => {
            const cellSize = 5;

            // patter fill: backward diagonal line in a 5x5 px square; two more diagonal lines offset to cover the corners when the main line is cut off
            return draw.pattern(cellSize, cellSize, add => {
                add.line(cellSize, 0, 0, cellSize).stroke(symbolStroke);
                add.line(cellSize, 0, 0, cellSize).move(cellSize / 2, cellSize / 2).stroke(symbolStroke);
                add.line(cellSize, 0, 0, cellSize).move(-cellSize / 2, -cellSize / 2).stroke(symbolStroke);
            });
        },
        esriSFSCross: (symbolColour, symbolStroke) => {
            const cellSize = 5;

            // patter fill: horizonal and vertical lines in a 5x5 px square
            return draw.pattern(cellSize, cellSize, add => {
                add.line(cellSize / 2, 0, cellSize / 2, cellSize).stroke(symbolStroke);
                add.line(0, cellSize / 2, cellSize, cellSize / 2).stroke(symbolStroke);
            });
        },
        esriSFSDiagonalCross: (symbolColour, symbolStroke) => {
            const cellSize = 7;

            // patter fill: crossing diagonal lines in a 7x7 px square
            return draw.pattern(cellSize, cellSize, add => {
                add.line(0, 0, cellSize, cellSize).stroke(symbolStroke);
                add.line(cellSize, 0, 0, cellSize).stroke(symbolStroke);
            });
        }
    };

    // jscs doesn't like enhanced object notation
    // jscs:disable requireSpacesInAnonymousFunctionExpression
    const symbolTypes = {
        esriSMS() { // ESRI Simple Marker Symbol
            const symbolColour = parseEsriColour(symbol.color);

            symbol.outline = symbol.outline || DEFAULT_OUTLINE;
            const outlineColour = parseEsriColour(symbol.outline.color);
            const outlineStroke = makeStroke({
                color: outlineColour.colour,
                opacity: outlineColour.opacity,
                width: symbol.outline.width,
                dasharray: ESRI_DASH_MAPS[symbol.outline.style]
            });

            // make an ESRI simple symbol and apply fill and outline to it
            const marker = esriSimpleMarkerSimbol[symbol.style](symbol)
                .fill({
                    color: symbolColour.colour,
                    opacity: symbolColour.opacity
                })
                .stroke(outlineStroke)
                .center(CONTAINER_CENTER, CONTAINER_CENTER)
                .rotate(symbol.angle || 0);

            fitInto(marker, CONTENT_SIZE);
        },
        esriSLS() { // ESRI Simple Line Symbol
            const lineColour = parseEsriColour(symbol.color);
            const lineStroke = makeStroke({
                color: lineColour.colour,
                opacity: lineColour.opacity,
                width: symbol.width,
                linecap: 'butt',
                dasharray: ESRI_DASH_MAPS[symbol.style]
            });

            const min = CONTENT_PADDING;
            const max = CONTAINER_SIZE - CONTENT_PADDING;
            draw.line(min, min, max, max)
                .stroke(lineStroke);
        },
        esriCLS() {  // ESRI Fancy Line Symbol
            this.esriSLS();
        },
        esriSFS() { // ESRI Simple Fill Symbol
            const symbolColour = parseEsriColour(symbol.color);
            const symbolStroke = makeStroke({
                color: symbolColour.colour,
                opacity: symbolColour.opacity
            });
            const symbolFill = esriSFSFills[symbol.style](symbolColour, symbolStroke);

            symbol.outline = symbol.outline || DEFAULT_OUTLINE;
            const outlineColour = parseEsriColour(symbol.outline.color);
            const outlineStroke = makeStroke({
                color: outlineColour.colour,
                opacity: outlineColour.opacity,
                width: symbol.outline.width,
                linecap: 'butt',
                dasharray: ESRI_DASH_MAPS[symbol.outline.style]
            });

            draw.rect(CONTENT_SIZE, CONTENT_SIZE)
                .center(CONTAINER_CENTER, CONTAINER_CENTER)
                .fill(symbolFill)
                .stroke(outlineStroke);
        },

        esriTS() {
            console.error('no support for feature service legend of text symbols');
        },

        esriPFS() { // ESRI Picture Fill Symbol
            // imageUri can be just an image url is specified or a dataUri string
            const imageUri = symbol.imageData ? `data:${symbol.contentType};base64,${symbol.imageData}` : symbol.url;

            const imageWidth = symbol.width * symbol.xscale;
            const imageHeight = symbol.height * symbol.yscale;

            symbol.outline = symbol.outline || DEFAULT_OUTLINE;
            const outlineColour = parseEsriColour(symbol.outline.color);
            const outlineStroke = makeStroke({
                color: outlineColour.colour,
                opacity: outlineColour.opacity,
                width: symbol.outline.width,
                dasharray: ESRI_DASH_MAPS[symbol.outline.style]
            });

            const picturePromise = shared.convertImagetoDataURL(imageUri)
                .then(imageUri => {
                    // make a fill from a tiled image
                    const symbolFill = draw.pattern(imageWidth, imageHeight, add =>
                        add.image(imageUri, imageWidth, imageHeight, true));

                    draw.rect(CONTENT_SIZE, CONTENT_SIZE)
                        .center(CONTAINER_CENTER, CONTAINER_CENTER)
                        .fill(symbolFill)
                        .stroke(outlineStroke);
                });

            return picturePromise;
        },

        esriPMS() { // ESRI PMS? Picture Marker Symbol
            // imageUri can be just an image url is specified or a dataUri string
            const imageUri = symbol.imageData ? `data:${symbol.contentType};base64,${symbol.imageData}` : symbol.url;

            // need to draw the image to get its size (technically not needed if we have a url, but this is simpler)
            const picturePromise = shared.convertImagetoDataURL(imageUri)
                .then(imageUri =>
                    svgDrawImage(draw, imageUri))
                .then(({ image }) => {
                    image
                        .center(CONTAINER_CENTER, CONTAINER_CENTER)
                        .rotate(symbol.angle || 0);

                    // scale image to fit into the symbology item container
                    fitInto(image, CONTENT_IMAGE_SIZE);
                });

            return picturePromise;
        }
    };

    // jscs:enable requireSpacesInAnonymousFunctionExpression

    // console.log(symbol.type, label, '--START--');
    // console.log(symbol);

    return Promise.resolve(symbolTypes[symbol.type]())
        .then(() => {
            // console.log(symbol.type, label, '--DONE--');

            // remove element from the page
            window.document.body.removeChild(container);
            return { label, svgcode: draw.svg() };
        }).catch(error => console.log(error));

    /**
     * Creates a stroke style by applying custom rules to the default stroke.
     * @param {Object} overrides any custom rules to apply on top of the defaults
     * @return {Object} a stroke object
     * @private
     */
    function makeStroke(overrides) {
        return Object.assign({}, DEFAULT_STROKE, overrides);
    }

    /**
     * Fits svg element in the size specified
     * @param {Ojbect} element svg element to fit
     * @param {Number} CONTAINER_SIZE width/height of a container to fit the element into
     */
    function fitInto(element, CONTAINER_SIZE) {
        // const elementRbox = element.rbox();
        // const elementRbox = element.screenBBox();

        const elementRbox = element.node.getBoundingClientRect(); // marker.rbox(); //rbox doesn't work properly in Chrome for some reason
        const scale = CONTAINER_SIZE / Math.max(elementRbox.width, elementRbox.height);
        if (scale < 1) {
            element.scale(scale);
        }
    }

    /**
    * Convert an ESRI colour object to SVG rgb format.
    * @private
    * @param  {Array} c ESRI Colour array
    * @return {Object} colour and opacity in SVG format
    */
    function parseEsriColour(c) {
        if (c) {
            return {
                colour: `rgb(${c[0]},${c[1]},${c[2]})`,
                opacity: c[3] / 255
            };
        } else {
            return {
                colour: 'rgb(0, 0, 0)',
                opacity: 0
            };
        }
    }
}

/**
 * Renders a specified image on an svg element. This is a helper function that wraps around async `draw.image` call in the svg library.
 *
 * @function svgDrawImage
 * @private
 * @param {Object} draw svg element to render the image onto
 * @param {String} imageUri image url or dataURL of the image to render
 * @param {Number} width [optional = 0] width of the image
 * @param {Number} height [optional = 0] height of the image
 * @param {Boolean} crossOrigin [optional = true] specifies if the image should be loaded as crossOrigin
 * @return {Promise} promise resolving with the loaded image and its loader object (see svg.js http://documentup.com/wout/svg.js#image for details)
 */
function svgDrawImage(draw, imageUri, width = 0, height = 0, crossOrigin = true) {
    const promise = new Promise((resolve, reject) => {
        const image = draw.image(imageUri, width, height, crossOrigin)
            .loaded(loader =>
                resolve({ image, loader }))
            .error(err => {
                reject(err);
                console.error(err);
            });
    });

    return promise;
}

/**
* Generate an array of legend items for an ESRI unique value or class breaks renderer.
* @private
* @param  {Object} renderer an ESRI unique value or class breaks renderer
* @param  {Array} childList array of children items of the renderer
* @param  {Object} window reference to the browser window
* @return {Array} a legend object populated with the symbol and label
*/
function scrapeListRenderer(renderer, childList, window) {
    const legend = childList.map(child => {
        return symbolToLegend(child.symbol, child.label, window);
    });

    if (renderer.defaultSymbol) {
        // class breaks dont have default label
        // TODO perhaps put in a default of "Other", would need to be in proper language
        legend.push(symbolToLegend(renderer.defaultSymbol, renderer.defaultLabel || '', window));
    }

    return legend;
}

function buildRendererToLegend(window) {
    /**
    * Generate a legend object based on an ESRI renderer.
    * @private
    * @param  {Object} renderer an ESRI renderer object in server JSON form
    * @param  {Integer} index the layer index of this renderer
    * @return {Object} an object matching the form of an ESRI REST API legend
    */
    return (renderer, index) => {
        // make basic shell object with .layers array
        const legend = {
            layers: [{
                layerId: index,
                legend: []
            }]
        };

        switch (renderer.type) {
            case SIMPLE:
                legend.layers[0].legend.push(symbolToLegend(renderer.symbol, renderer.label, window));
                break;

            case UNIQUE_VALUE:
                legend.layers[0].legend = scrapeListRenderer(renderer, renderer.uniqueValueInfos, window);
                break;

            case CLASS_BREAKS:
                legend.layers[0].legend = scrapeListRenderer(renderer, renderer.classBreakInfos, window);
                break;

            default:

                // FIXME make a basic blank entry (error msg as label?) to prevent things from breaking
                // Renderer we dont support
                console.error('encountered unsupported renderer legend type: ' + renderer.type);
        }
        return legend;
    };
}

/**
 * Returns the legend information of an ESRI map service.
 *
 * @function getMapServerLegend
 * @private
 * @param  {String} layerUrl service url (root service, not indexed endpoint)
 * @param  {Object} esriBundle collection of ESRI API objects
 * @returns {Promise} resolves in an array of legend data
 *
 */
function getMapServerLegend(layerUrl, esriBundle) {

    // standard json request with error checking
    const defService = esriBundle.esriRequest({
        url: `${layerUrl}/legend`,
        content: { f: 'json' },
        callbackParamName: 'callback',
        handleAs: 'json',
    });

    // wrap in promise to contain dojo deferred
    return new Promise((resolve, reject) => {
        defService.then(srvResult => {

            if (srvResult.error) {
                reject(srvResult.error);
            } else {
                resolve(srvResult);
            }
        }, error => {
            reject(error);
        });
    });

}

/**
 * Our symbology engine works off of renderers. When dealing with layers with no renderers,
 * we need to take server-side legend and convert it to a fake renderer, which lets us
 * leverage all the existing symbology code.
 *
 * @function mapServerLegendToRenderer
 * @private
 * @param {Object} serverLegend legend json from an esri map server
 * @param {Integer} layerIndex  the index of the layer in the legend we are interested in
 * @returns {Object} a fake unique value renderer based off the legend
 *
 */
function mapServerLegendToRenderer(serverLegend, layerIndex) {
    const layerLegend = serverLegend.layers.find(l => {
        return l.layerId === layerIndex;
    });

    // make the mock renderer
    return {
        type: 'uniqueValue',
        uniqueValueInfos: layerLegend.legend.map(ll => {
            return {
                label: ll.label,
                symbol: {
                    type: 'esriPMS',
                    imageData: ll.imageData,
                    contentType: ll.contentType
                }
            };
        })
    };
}

/**
  * Our symbology engine works off of renderers. When dealing with layers with no renderers,
  * we need to take server-side legend and convert it to a fake renderer, which lets us
  * leverage all the existing symbology code.
  *
  * Same as mapServerLegendToRenderer function but combines all layer renderers.
  *
  * @function mapServerLegendToRendererAll
  * @private
  * @param {Object} serverLegend legend json from an esri map server
  * @returns {Object} a fake unique value renderer based off the legend
  */

function mapServerLegendToRendererAll(serverLegend) {

    const layerRenders = serverLegend.layers.map(layer =>
        layer.legend.map(layerLegend => ({
            label: layerLegend.label,
            symbol: {
                type: 'esriPMS',
                imageData: layerLegend.imageData,
                contentType: layerLegend.contentType
            }
        }))
    );

    return {
        type: 'uniqueValue',
        uniqueValueInfos: [].concat(...layerRenders)
    };
}

function buildMapServerToLocalLegend(esriBundle, geoApi) {
    /**
     * Orchestrator function that will:
     * - Fetch a legend from an esri map server
     * - Extract legend for a specific sub layer
     * - Convert server legend to a temporary renderer
     * - Convert temporary renderer to a viewer-formatted legend (return value)
     *
     * @function mapServerToLocalLegend
     * @param {String}    mapServerUrl  service url (root service, not indexed endpoint)
     * @param {Integer}   [layerIndex]    the index of the layer in the legend we are interested in. If not provided, all layers will be collapsed into a single legend
     * @returns {Promise} resolves in a viewer-compatible legend for the given server and layer index
     *
     */
    return (mapServerUrl, layerIndex) => {
        // get esri legend from server
        return getMapServerLegend(mapServerUrl, esriBundle).then(serverLegendData => {
            // derive renderer for specified layer
            const fakeRenderer = typeof layerIndex === 'undefined' ?
                mapServerLegendToRendererAll(serverLegendData) :
                mapServerLegendToRenderer(serverLegendData, layerIndex);

            // convert renderer to viewer specific legend
            return geoApi.symbology.rendererToLegend(fakeRenderer);
        });
    };
}

// TODO getZoomLevel should probably live in a file not named symbology
/**
* Takes the lod list and finds level as close to and above scale limit
*
* @param {Array} lods array of esri LODs https://developers.arcgis.com/javascript/jsapi/lod-amd.html
* @param {Integer} maxScale object largest zoom level for said layer
* @returns {Number} current LOD
*/
function getZoomLevel(lods, maxScale) {
    // Find level as close to and above scaleLimit
    const scaleLimit = maxScale; // maxScale obj in returned config
    let found = false;
    let currentLod = Math.ceil(lods.length / 2);
    let lowLod = 0;
    let highLod = lods.length - 1;

    if (maxScale === 0) {
        return lods.length - 1;
    }

    // Binary Search
    while (!found) {
        if (lods[currentLod].scale >= scaleLimit) {
            lowLod = currentLod;
        } else {
            highLod = currentLod;
        }
        currentLod = Math.floor((highLod + lowLod) / 2);
        if (highLod === lowLod + 1) {
            found = true;
        }
    }
    return currentLod;
}

module.exports = (esriBundle, geoApi, window) => {
    return {
        getGraphicIcon,
        getGraphicSymbol,
        rendererToLegend: buildRendererToLegend(window),
        generatePlaceholderSymbology,
        generateWMSSymbology,
        getZoomLevel,
        enhanceRenderer,
        mapServerToLocalLegend: buildMapServerToLocalLegend(esriBundle, geoApi)
    };
};
