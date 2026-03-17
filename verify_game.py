from playwright.sync_api import Page, expect, sync_playwright
import os

def verify_game(page: Page):
    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))
    # The server might take a moment to start
    page.goto("http://localhost:5174")
    page.wait_for_timeout(2000)

    # Take initial screenshot of car selector
    page.screenshot(path="/home/jules/verification/selector.png")

    # Select first car
    buttons = page.locator("#car-selector button")
    if buttons.count() > 0:
        buttons.first.click()
    else:
        # Fallback if UI is different
        page.click("button")

    page.wait_for_timeout(2000) # Wait for model loading

    # Take screenshot of the game
    page.screenshot(path="/home/jules/verification/game_start.png")

    # Simulate driving: Hold 'W' for 3 seconds
    page.keyboard.down("w")
    page.wait_for_timeout(3000)

    # Hold 'A' to turn
    page.keyboard.down("a")
    page.wait_for_timeout(1000)
    page.keyboard.up("a")

    # Hold 'Shift' for nitro
    page.keyboard.down("Shift")
    page.wait_for_timeout(2000)
    page.keyboard.up("Shift")

    page.keyboard.up("w")
    page.wait_for_timeout(1000)

    # Final screenshot
    page.screenshot(path="/home/jules/verification/verification_final.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir="/home/jules/verification/video")
        page = context.new_page()
        try:
            verify_game(page)
        finally:
            context.close()
            browser.close()
