const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { URL, URLSearchParams } = require('url');
const {Buffer} =  require('buffer');
const fs = require('fs').promises;
const proj4 = require('proj4');
const sharp = require('sharp');
const staticApi = "https://maps.googleapis.com/maps/api/staticmap";
const {joinImages, reprojectToImageCoord} = require('join-images');

const {resolutions} = require('./mercator-resolutions.js');

class LargeMap {
  constructor (googleApiKey, options={}) {
    if (!googleApiKey) throw new Error('Google API key is required');
    this.googleApiKey = googleApiKey;
    this.maptype = options.maptype || options.mapType || 'roadmap';
    this.format = options.format || 'jpg';
    this.scale = options.scale || 1;
    this.maxTileSize = options.maxTileSize || 600;
    this.style = options.style || false;
    this.language = options.language || '';
    this.region = options.region || '';
  }

  async getImage (extent, zoom = 8) {
    if (!extent) throw new Error('Missing parameter: extent');
    const {tiles} = this.getTiles(extent, zoom);
    const rows = tiles.length;
    const cols = tiles.length > 0 ? tiles[0].length : 0;
    console.log('tiles count: ' + (rows * cols));
    // return Promise.resolve(false);
    const rowImgs = [];
    for await (const [i, row] of tiles.entries()) {
      const colImgs = [];
      for await (const tile of row) {
        console.log('Fetching tile - row: %s, col: %s', tile.row, tile.col );
        const params = new URLSearchParams({
          key: this.googleApiKey,
          maptype: this.mapType,
          format: this.format,
          scale: this.scale,
          size: tile.imageWidth + 'x' + (tile.imageHeight+40),
          center: tile.center[1] + ',' + tile.center[0],
          zoom: zoom,
          style: this.style,
          language: this.language,
          region: this.region
        });
        let paramsStr = params.toString();
        
        // console.log(JSON.stringify(tile));
        console.log('required size: '+tile.imageWidth + 'x' + (tile.imageHeight)+' requesting: '+tile.imageWidth + 'x' + (tile.imageHeight+40));
        const img = await fetch(staticApi + '?' + paramsStr);
        if (!img.ok) {
          throw new Error(`Google API response: statusCode: ${img.status}, statusText: ${img.statusText}, message: ${await img.text()}`);
        }
        const imgb = Buffer.from(await img.arrayBuffer());


        const croppedImgBuffer = await sharp(imgb)
          .extract({
            left: 0,
            top: 20*this.scale,
            width: tile.imageWidth*this.scale,          // original width
            height: (tile.imageHeight*this.scale)    // crop 20px from top + bottom
          })
          .toBuffer();
        //await fs.mkdir(process.cwd() + '/tiles');
        /*
        await fs.writeFile(
          process.cwd() + '/tiles/' + `tile-${tile.row}-${tile.col}.jpg`,
          imgb).catch(console.error);
        */
        colImgs.push(croppedImgBuffer);
      }
      try {
        const rowImg = await joinImages(colImgs, {direction: 'horizontal'});
        const rowImgBuf = Buffer.from(await rowImg.jpeg().toBuffer());
        //await fs.writeFile(process.cwd() + '/tmp/static-maps/' + `row-${i}.jpg`, rowImgBuf);
        rowImgs.push(rowImgBuf);
      } catch (error) {
        return Promise.reject(error);
      }
    };
    try {
      const image = await joinImages(rowImgs, {direction: 'vertical'});
      const imageBuf = Buffer.from(await image.jpeg().toBuffer());
      return Promise.resolve(imageBuf);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  getTiles (extent, zoom = 8) {
    // extent in meters
    const [left, bottom] = proj4('EPSG:4326', 'EPSG:3857', extent.slice(0,2));
    const [right, top] = proj4('EPSG:4326', 'EPSG:3857', extent.slice(2,4));
    // height/width devided by your tile size in meters
    const sizeMeter = this.maxTileSize * resolutions[zoom];
    let cols = Math.ceil( (right - left) / sizeMeter );
    let rows = Math.ceil( (top - bottom) / sizeMeter );
    // console.log(JSON.stringify({left, bottom, right, top, size,
    //   zoom, res: resolutions[zoom], sizeMeter, rows, cols, }));
    const tiles = [];
    const widthMeter = (right - left)/cols;
    const heightMeter = (top - bottom)/rows;
    const imageWidth = Math.round(widthMeter/resolutions[zoom]);
    const imageHeight = Math.round(heightMeter/resolutions[zoom]);

    for (let i = 0; i < rows; i++) {
      tiles[i] = []
      for (let j = 0; j < cols; j++) {
        const centerMeter = [
          left + (widthMeter * j) + widthMeter/2,
          top - (heightMeter * i) - heightMeter/2
        ];
        const bottomLeftMeter = [
          left + (widthMeter * j),
          top - ((heightMeter * i) + heightMeter)
        ];
        const rightTopMeter = [
          left + (widthMeter * j) + widthMeter,
          top - (heightMeter * i)
        ];
        let tile = {
          row: i,
          col: j,
          center: proj4('EPSG:3857', 'EPSG:4326', centerMeter),
          extent: [
            ...proj4('EPSG:3857', 'EPSG:4326', bottomLeftMeter),
            ...proj4('EPSG:3857', 'EPSG:4326', rightTopMeter)
          ],
          imageWidth, imageHeight
        };
        tiles[i][j] = tile;
      }
    }
    return {
      tiles,
      imageWidth: imageWidth * cols,
      imageHeight: imageHeight * rows
    }
  }
}

module.exports = {LargeMap};
