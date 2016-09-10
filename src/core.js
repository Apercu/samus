import blessed from 'blessed'
import { spawn } from 'child_process'

import fetch from './fetch'
import * as history from './history'

const isBasicAuthErr = err => (
  err.status
  && err.status === 401
  && err.response
  && err.response.headers
  && err.response.headers['www-authenticate']
  && err.response.headers['www-authenticate'].indexOf('Basic') > -1
)

class Samus {

  constructor (url, config, args) {

    this.config = config
    this.args = args
    this.url = url || (this.config && this.config.defaultServer && this.config.defaultServer.url)

    if (this.url && this.url[this.url.length - 1] === '/') {
      this.url = this.url.substr(0, this.url.length - 1)
    }

    this.list = null
    this.authForm = null
    this.credentials = (this.config && this.config.defaultServer && this.config.defaultServer.credentials) || null

    this.screen = blessed.screen({ smartCSR: true })
    this.screen.key(['escape', 'q', 'C-c'], () => this.screen.destroy())

    this.loader = blessed.loading()
    this.screen.append(this.loader)

    this.load()

  }

  destroy (msg) {
    this.screen.destroy()
    if (msg) {
      console.log(msg)
    }
    process.exit()
  }

  getFullUrl (text) {
    let name = `${this.url}/${text}`
    if (!name.startsWith('http')) {
      name = `http://${name}`
    }
    return name
  }

  buildArgs (text) {

    const args = ['--quiet']
    const name = this.getFullUrl(text)

    if (this.args.fullscreen) {
      args.push('--fs')
    }

    args.push(name)
    return args
  }

  markRead (text) {
    const full = this.getFullUrl(text)
    return history.set(full)
  }

  checkmarkText (text) {
    if (text === '../' || text[text.length - 1] === '/') { return text }
    return `[${history.has(this.getFullUrl(encodeURI(text))) ? 'x' : ' '}] ${text}`
  }

  output (text) {
    this.screen.destroy()

    console.log(`\n▶ Selected [ ${decodeURI(text)} ]`)
    console.log('▶ Launching mpv...\n')

    const mpvArgs = this.buildArgs(text)

    this.markRead(text)
      .then(() => {
        const child = spawn('mpv', mpvArgs)
        child.on('error', err => {
          if (err.code === 'ENOENT') {
            console.log('\nPlease install mpv to use samus (https://mpv.io/).\n')
            process.exit()
          }
        })
        child.stdout.pipe(process.stdout)
        child.stderr.pipe(process.stderr)
      })

  }

  navigate (suburl) {
    this.url = `${this.url}/${suburl}`
    this.load()
  }

  load () {
    if (this.list) { this.screen.remove(this.list) }
    this.loader.load(`▶ Loading ${this.url}`)
    fetch(this.url, this.credentials)
      .then(items => {
        this.list = blessed.list({
          items: items.map(this.checkmarkText.bind(this)),
          parent: this.screen,
          border: 'line',
          label: ` ${this.url} `,
          keys: true,
          style: {
            selected: {
              bg: 'white',
              fg: 'black'
            }
          },
        })
        this.list.on('select', (item) => {
          const text = item.getText()
          if (text === '../') {
            const isRoot = this.url.replace(/https?:\/\//, '').lastIndexOf('/') === -1
            if (!isRoot) {
              this.url = this.url.substring(0, this.url.lastIndexOf('/'))
              this.load()
            }
          } else if (text[text.length - 1] === '/') {
            this.navigate(text.substr(0, text.length - 1))
          } else {
            this.output(encodeURI(text.substr(4)))
          }
        })
        this.list.focus()
        this.screen.render()
      })
      .catch(err => {
        if (isBasicAuthErr(err)) {
          this.destroy('This site is protected. You may need to add your credentials in your ~/.samusrc, check README')
        } else {
          this.destroy(err)
        }
      })
      .then(() => this.loader.stop())
  }

}

export default Samus
