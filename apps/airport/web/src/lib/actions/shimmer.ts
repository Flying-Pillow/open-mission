type ShimmerThinkingOptions = {
    speed?: number;
    disabled?: boolean;
};

const SHIMMER_CLASS_NAME = "fp-shimmer-thinking";
const SHIMMER_DURATION_VAR = "--fp-shimmer-duration";
const SHIMMER_TEXT_ATTR = "data-fp-shimmer-text";

export function shimmerThinking(
    node: HTMLElement,
    options: ShimmerThinkingOptions = {},
) {
    let speed = options.speed ?? 2.5;
    let disabled = options.disabled ?? false;
    const syncText = () => {
        const text = node.textContent?.trim() ?? "";
        if (text.length > 0) {
            node.setAttribute(SHIMMER_TEXT_ATTR, text);
            return;
        }

        node.removeAttribute(SHIMMER_TEXT_ATTR);
    };
    const observer = new MutationObserver(() => {
        syncText();
    });

    function apply(): void {
        if (disabled) {
            node.classList.remove(SHIMMER_CLASS_NAME);
            node.style.removeProperty(SHIMMER_DURATION_VAR);
            return;
        }

        syncText();
        node.classList.add(SHIMMER_CLASS_NAME);
        node.style.setProperty(SHIMMER_DURATION_VAR, `${speed}s`);
    }

    observer.observe(node, {
        childList: true,
        characterData: true,
        subtree: true,
    });
    apply();

    return {
        update(nextOptions: ShimmerThinkingOptions = {}) {
            speed = nextOptions.speed ?? 2.5;
            disabled = nextOptions.disabled ?? false;
            apply();
        },

        destroy() {
            observer.disconnect();
            node.classList.remove(SHIMMER_CLASS_NAME);
            node.style.removeProperty(SHIMMER_DURATION_VAR);
            node.removeAttribute(SHIMMER_TEXT_ATTR);
        },
    };
}