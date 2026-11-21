import { evaluateCombo } from '../packages/core/src/quorum'

const slots = [
  { id: 'fri', title: 'Friday', time: '7:00 PM Central' },
  { id: 'sat', title: 'Saturday', time: '7:00 PM Central' },
]
const option = { id: 'table', minPlayers: 4, maxPlayers: 4, roles: [{ key: 'gm', label: 'Game master', min: 1 }] }
const event = { hostId: 'Alex' }
const key = 'onemore:weekend-demo:v1'
function response(userId, seq, days, roles = []) {
  return { userId, seq, intent: 'joined', roles, optionIds: [option.id],
    availability: Object.fromEntries(days.map(day => [day, 'yes'])) }
}
const group = [
  response('Alex', 0, ['fri', 'sat'], ['gm']),
  response('Maya', 1, ['fri', 'sat']),
  response('Jordan', 2, ['fri']),
]
let choices = []
try {
  const saved = JSON.parse(localStorage.getItem(key))
  if (Array.isArray(saved)) choices = slots.map(slot => slot.id).filter(id => saved.includes(id))
} catch { /* Browser storage is optional. */ }

const cards = slots.map(slot => {
  const card = document.createElement('article')
  card.className = 'card'
  card.innerHTML = '<div class="row"><h2></h2><span class="count"></span></div><p class="time"></p><p class="roster"></p><label><input type="checkbox">I’m available</label><output aria-live="polite"></output>'
  card.querySelector('h2').textContent = slot.title
  card.querySelector('.time').textContent = slot.time
  const input = card.querySelector('input')
  input.setAttribute('aria-label', 'Available on ' + slot.title)
  input.addEventListener('change', () => {
    choices = choices.filter(id => id !== slot.id)
    if (input.checked) choices.push(slot.id)
    saveAndRender()
  })
  document.querySelector('#slots').append(card)
  return { slot, card, input }
})
function render() {
  const responses = [...group, response('You', 3, choices)]
  for (const { slot, card, input } of cards) {
    const result = evaluateCombo(event, option, slot, responses)
    input.checked = choices.includes(slot.id)
    card.classList.toggle('ready', result.feasible)
    card.querySelector('.count').textContent = result.eligibleIds.length + ' / 4 players'
    card.querySelector('.roster').textContent = result.roster.map(id => id === 'Alex' ? 'Alex (GM)' : id).join(' · ')
    card.querySelector('output').textContent = result.feasible ? 'Ready for the host to confirm' :
      'Needs ' + result.stillNeed + ' more ' + (result.stillNeed === 1 ? 'player' : 'players')
  }
}
function saveAndRender() {
  try { localStorage.setItem(key, JSON.stringify(choices)) } catch { /* Continue in memory. */ }
  render()
}
document.querySelector('#reset').addEventListener('click', () => {
  choices = []
  saveAndRender()
})
render()
