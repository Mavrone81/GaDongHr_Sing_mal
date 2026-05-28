'use strict';
/**
 * Security regression test for C-18:
 *   PUT /candidates/:id must not accept isHired / isOfferMade — these are
 *   workflow state managed only by POST /candidates/:id/approve, which
 *   enforces the FCF MyCareersFuture compliance gate.
 */
const fs = require('fs');
const path = require('path');

const routesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'recruitment.routes.js'), 'utf8');

describe('C-18 PUT /candidates/:id strips workflow state', () => {
  // Match the PUT handler region until the close of its prisma.candidate.update call.
  function getPutHandler() {
    const start = routesSrc.indexOf("router.put('/candidates/:id'");
    expect(start).toBeGreaterThan(-1);
    // Take a window large enough to include the update() call.
    return routesSrc.slice(start, start + 2000);
  }

  test('handler does not destructure isHired from req.body', () => {
    const handler = getPutHandler();
    // The body destructuring line should not name isHired or isOfferMade.
    const destructureLine = handler.match(/const \{[^}]*\} = req\.body;/);
    expect(destructureLine).not.toBeNull();
    expect(destructureLine[0]).not.toMatch(/\bisHired\b/);
    expect(destructureLine[0]).not.toMatch(/\bisOfferMade\b/);
  });

  test('update data block does not include isHired or isOfferMade', () => {
    const handler = getPutHandler();
    const dataBlock = handler.match(/data:\s*\{[^}]*\}/);
    expect(dataBlock).not.toBeNull();
    expect(dataBlock[0]).not.toMatch(/\bisHired\b/);
    expect(dataBlock[0]).not.toMatch(/\bisOfferMade\b/);
  });
});
