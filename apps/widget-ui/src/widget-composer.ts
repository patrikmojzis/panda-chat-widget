type WidgetComposerKeyboardEvent = {
  key: string;
  shiftKey: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
};

type WidgetComposerKeyAction = {
  shouldPreventDefault: boolean;
  shouldSubmit: boolean;
};

export function resolveWidgetComposerKeyAction(
  event: WidgetComposerKeyboardEvent,
  draftMessage: string,
): WidgetComposerKeyAction {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) {
    return { shouldPreventDefault: false, shouldSubmit: false };
  }

  return { shouldPreventDefault: true, shouldSubmit: draftMessage.trim().length > 0 };
}
