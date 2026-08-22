/**
 * スマート一覧プラグイン 詳細絞り込みパネル・表示列パネル・列ヘッダーフィルタ
 * いずれも同じ filter state / 列状態を編集する入口であり、独自の状態を持たない。
 */
window.SubtableList = window.SubtableList || {};
((DL) => {
  'use strict';

  const createElement = (tagName, className, text) => {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined && text !== null) {
      element.textContent = text;
    }
    return element;
  };

  const createButton = (className, text) => {
    const button = createElement('button', className, text);
    button.type = 'button';
    return button;
  };

  const cloneFilters = (filters) => ({
    quick: filters.quick,
    conditions: JSON.parse(JSON.stringify(filters.conditions || []))
  });

  /**
   * パネル群を生成する。
   * context: { getColumns, getColumnMap, getFilters, getColumnState, getTokenOptions, handlers }
   * handlers: onApplyFilters(filters) / onApplyColumns({ visibleKeys, columnOrder })
   */
  DL.createPanels = (context) => {
    const handlers = context.handlers || {};

    /* ================================================== 共通の土台 */

    const overlay = createElement('div', 'dl-overlay');
    overlay.hidden = true;
    document.body.appendChild(overlay);

    const sidePanel = createElement('div', 'dl-side-panel');
    sidePanel.hidden = true;
    document.body.appendChild(sidePanel);

    const popover = createElement('div', 'dl-popover');
    popover.hidden = true;
    document.body.appendChild(popover);

    let activePopoverAnchor = null;

    const closeSidePanel = () => {
      sidePanel.hidden = true;
      overlay.hidden = true;
      sidePanel.textContent = '';
    };

    const closePopover = () => {
      popover.hidden = true;
      popover.textContent = '';
      activePopoverAnchor = null;
    };

    const closeAll = () => {
      closeSidePanel();
      closePopover();
    };

    overlay.addEventListener('click', closeSidePanel);

    // destroy() でまとめて解除できるよう、document へのリスナーを記録しておく
    const globalListeners = [];
    const addGlobalListener = (type, handler) => {
      document.addEventListener(type, handler);
      globalListeners.push({ type, handler });
    };

    addGlobalListener('mousedown', (event) => {
      if (popover.hidden) {
        return;
      }
      if (popover.contains(event.target)) {
        return;
      }
      if (activePopoverAnchor && activePopoverAnchor.contains(event.target)) {
        return;
      }
      closePopover();
    });

    addGlobalListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeAll();
      }
    });

    const positionPopover = (anchor) => {
      activePopoverAnchor = anchor;
      popover.hidden = false;
      const anchorRect = anchor.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      let left = anchorRect.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      let top = anchorRect.bottom + 4;
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, anchorRect.top - height - 4);
      }
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };

    /* ================================================== 値入力の生成 */

    const buildValueInputs = (container, column, condition, onChange) => {
      container.textContent = '';
      const definition = DL.getOperatorDefinition(column.type, condition.op);
      if (!definition || definition.valueType === 'none') {
        return;
      }

      const createInput = (type, value, placeholder) => {
        const input = document.createElement('input');
        input.type = type;
        input.className = 'dl-input';
        input.value = value === null || value === undefined ? '' : value;
        if (placeholder) {
          input.placeholder = placeholder;
        }
        return input;
      };

      switch (definition.valueType) {
        case 'text': {
          const input = createInput('text', condition.value, '値を入力');
          input.addEventListener('input', () => onChange(input.value));
          container.appendChild(input);
          break;
        }
        case 'number': {
          const input = createInput('number', condition.value, '数値');
          input.addEventListener('input', () => onChange(input.value));
          container.appendChild(input);
          break;
        }
        case 'time': {
          const input = createInput('time', condition.value, '');
          input.addEventListener('input', () => onChange(input.value));
          container.appendChild(input);
          break;
        }
        case 'numberRange':
        case 'dateRange':
        case 'timeRange': {
          const inputType = definition.valueType === 'numberRange'
            ? 'number'
            : (definition.valueType === 'dateRange' ? 'date' : 'time');
          const range = condition.value || { from: '', to: '' };
          const wrapper = createElement('div', 'dl-range');
          const fromInput = createInput(inputType, range.from, '開始');
          const toInput = createInput(inputType, range.to, '終了');
          const emit = () => onChange({ from: fromInput.value, to: toInput.value });
          fromInput.addEventListener('input', emit);
          toInput.addEventListener('input', emit);
          wrapper.appendChild(fromInput);
          wrapper.appendChild(createElement('span', 'dl-range-sep', '〜'));
          wrapper.appendChild(toInput);
          container.appendChild(wrapper);
          break;
        }
        case 'tokens': {
          const selected = new Set(condition.value || []);
          const result = context.getTokenOptions(column);
          if (result.options.length === 0) {
            container.appendChild(createElement('p', 'dl-note', '選択できる値がありません。'));
            break;
          }
          const list = createElement('div', 'dl-token-list');
          result.options.forEach((option) => {
            const item = createElement('label', 'dl-token-item');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selected.has(option.token);
            checkbox.addEventListener('change', () => {
              if (checkbox.checked) {
                selected.add(option.token);
              } else {
                selected.delete(option.token);
              }
              onChange(Array.from(selected));
            });
            item.appendChild(checkbox);
            item.appendChild(createElement('span', 'dl-token-label', option.label));
            if (option.count > 0) {
              item.appendChild(createElement('span', 'dl-token-count', String(option.count)));
            }
            list.appendChild(item);
          });
          container.appendChild(list);
          if (result.truncated) {
            container.appendChild(createElement('p', 'dl-note', '値が多いため一部のみ表示しています。'));
          }
          break;
        }
        default:
          break;
      }
    };

    const buildColumnSelect = (columns, selectedKey) => {
      const select = document.createElement('select');
      select.className = 'dl-select dl-select-block';

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '（フィールドを選択）';
      select.appendChild(placeholder);

      const groups = [
        { scope: DL.SCOPE.PARENT, label: '親レコード' },
        { scope: DL.SCOPE.TABLE, label: '明細' }
      ];
      groups.forEach((group) => {
        const target = columns.filter((column) => column.scope === group.scope && DL.isFilterableType(column.type));
        if (target.length === 0) {
          return;
        }
        const optGroup = document.createElement('optgroup');
        optGroup.label = group.label;
        target.forEach((column) => {
          const option = document.createElement('option');
          option.value = column.key;
          option.textContent = column.label;
          optGroup.appendChild(option);
        });
        select.appendChild(optGroup);
      });

      select.value = selectedKey || '';
      return select;
    };

    /* ================================================== 詳細絞り込みパネル */

    const openFilterPanel = () => {
      closePopover();
      const columns = context.getColumns();
      const columnMap = context.getColumnMap();
      const working = cloneFilters(context.getFilters());

      sidePanel.textContent = '';
      overlay.hidden = false;
      sidePanel.hidden = false;

      const header = createElement('div', 'dl-side-header');
      header.appendChild(createElement('h3', 'dl-side-title', '絞り込み'));
      const closeButton = createButton('dl-side-close', '\u00D7');
      closeButton.title = '閉じる';
      closeButton.addEventListener('click', closeSidePanel);
      header.appendChild(closeButton);
      sidePanel.appendChild(header);

      const body = createElement('div', 'dl-side-body');
      sidePanel.appendChild(body);

      const conditionList = createElement('div', 'dl-condition-list');
      body.appendChild(conditionList);

      const renderConditions = () => {
        conditionList.textContent = '';
        if (working.conditions.length === 0) {
          conditionList.appendChild(createElement('p', 'dl-note', '条件がありません。「条件を追加」から作成してください。'));
        }

        working.conditions.forEach((condition) => {
          const column = columnMap[condition.key];
          const card = createElement('div', 'dl-condition');

          const cardHeader = createElement('div', 'dl-condition-head');
          const columnSelect = buildColumnSelect(columns, condition.key);
          columnSelect.addEventListener('change', () => {
            const nextColumn = columnMap[columnSelect.value];
            condition.key = columnSelect.value;
            condition.op = nextColumn ? DL.getDefaultOperator(nextColumn.type) : '';
            condition.value = nextColumn ? DL.createEmptyValue(nextColumn.type, condition.op) : null;
            renderConditions();
          });
          cardHeader.appendChild(columnSelect);

          const removeButton = createButton('dl-condition-remove', '\u00D7');
          removeButton.title = 'この条件を削除';
          removeButton.addEventListener('click', () => {
            working.conditions = working.conditions.filter((item) => item.id !== condition.id);
            renderConditions();
          });
          cardHeader.appendChild(removeButton);
          card.appendChild(cardHeader);

          if (column) {
            const operatorSelect = document.createElement('select');
            operatorSelect.className = 'dl-select dl-select-block';
            DL.getFilterOperators(column.type).forEach((operator) => {
              const option = document.createElement('option');
              option.value = operator.op;
              option.textContent = operator.label;
              operatorSelect.appendChild(option);
            });
            operatorSelect.value = condition.op;
            card.appendChild(operatorSelect);

            const valueArea = createElement('div', 'dl-condition-value');
            card.appendChild(valueArea);

            operatorSelect.addEventListener('change', () => {
              condition.op = operatorSelect.value;
              condition.value = DL.createEmptyValue(column.type, condition.op);
              buildValueInputs(valueArea, column, condition, (value) => {
                condition.value = value;
              });
            });

            buildValueInputs(valueArea, column, condition, (value) => {
              condition.value = value;
            });
          } else {
            card.appendChild(createElement('p', 'dl-note', 'このフィールドは利用できません。'));
          }

          conditionList.appendChild(card);
        });
      };

      renderConditions();

      const addButton = createButton('dl-btn dl-btn-block', '＋ 条件を追加');
      addButton.addEventListener('click', () => {
        const first = columns.find((column) => DL.isFilterableType(column.type));
        if (!first) {
          return;
        }
        working.conditions.push(DL.createCondition(first.key, first.type));
        renderConditions();
      });
      body.appendChild(addButton);

      const footer = createElement('div', 'dl-side-footer');
      const clearButton = createButton('dl-btn', 'すべてクリア');
      clearButton.addEventListener('click', () => {
        working.conditions = [];
        renderConditions();
      });
      footer.appendChild(clearButton);

      const applyButton = createButton('dl-btn dl-btn-primary', '絞り込みを反映');
      applyButton.addEventListener('click', () => {
        if (handlers.onApplyFilters) {
          handlers.onApplyFilters(working);
        }
        closeSidePanel();
      });
      footer.appendChild(applyButton);
      sidePanel.appendChild(footer);
    };

    /* ================================================== 表示列パネル */

    const openColumnPanel = (anchor) => {
      closeSidePanel();
      popover.textContent = '';
      popover.className = 'dl-popover dl-popover-columns';

      const columnState = context.getColumnState();
      const columnMap = context.getColumnMap();
      let order = columnState.columnOrder.slice();
      const visible = new Set(columnState.visibleKeys);
      let frozenColumnCount = Math.max(0, Number(columnState.frozenColumnCount) || 0);

      popover.appendChild(createElement('div', 'dl-popover-title', '表示する列と並び順'));
      popover.appendChild(createElement('p', 'dl-note', '左の三本線をドラッグして並び替えます。固定は左から連続します。'));

      const list = createElement('div', 'dl-column-list');
      popover.appendChild(list);

      let draggingKey = null;
      const scroller = DL.createEdgeAutoScroller(list);

      const renderList = () => {
        const scrollTop = list.scrollTop;
        list.textContent = '';
        const visibleOrder = order.filter((key) => visible.has(key));
        frozenColumnCount = Math.min(frozenColumnCount, visibleOrder.length);
        const keys = order.filter((key) => Boolean(columnMap[key]));

        keys.forEach((key) => {
          const column = columnMap[key];
          const item = createElement('div', 'dl-column-item');
          item.draggable = true;
          item.dataset.key = key;

          item.appendChild(createElement('span', 'dl-drag-handle', '\u2630'));

          const label = createElement('label', 'dl-column-label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = visible.has(key);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              visible.add(key);
            } else {
              const previousVisibleOrder = order.filter((itemKey) => visible.has(itemKey));
              const previousVisibleIndex = previousVisibleOrder.indexOf(key);
              if (previousVisibleIndex >= 0 && previousVisibleIndex < frozenColumnCount) {
                // 途中の固定列を非表示にした場合、それより右側の固定も解除する
                frozenColumnCount = previousVisibleIndex;
              }
              visible.delete(key);
            }
            renderList();
          });
          label.appendChild(checkbox);
          label.appendChild(createElement('span', 'dl-column-name', column.label));
          label.appendChild(createElement('span', `dl-scope-tag dl-scope-${column.scope}`, column.scope === DL.SCOPE.PARENT ? '親' : '明細'));
          item.appendChild(label);

          const visibleIndex = visibleOrder.indexOf(key);
          const frozenLabel = createElement('label', 'dl-column-frozen-label');
          const frozenCheckbox = document.createElement('input');
          frozenCheckbox.type = 'checkbox';
          frozenCheckbox.checked = visibleIndex >= 0 && visibleIndex < frozenColumnCount;
          frozenCheckbox.disabled = visibleIndex < 0;
          frozenCheckbox.addEventListener('change', () => {
            frozenColumnCount = frozenCheckbox.checked ? visibleIndex + 1 : visibleIndex;
            renderList();
          });
          frozenLabel.appendChild(frozenCheckbox);
          frozenLabel.appendChild(createElement('span', null, '固定'));
          item.appendChild(frozenLabel);

          item.addEventListener('dragstart', (event) => {
            draggingKey = key;
            item.classList.add('is-dragging');
            event.dataTransfer.effectAllowed = 'move';
            // Firefoxではデータ設定がないとドラッグが開始されない
            event.dataTransfer.setData('text/plain', key);
            scroller.start();
          });
          item.addEventListener('dragend', () => {
            draggingKey = null;
            item.classList.remove('is-dragging');
            Array.from(list.children).forEach((child) => child.classList.remove('is-drop-target'));
            scroller.stop();
          });
          item.addEventListener('dragover', (event) => {
            if (!draggingKey || draggingKey === key) {
              return;
            }
            event.preventDefault();
            item.classList.add('is-drop-target');
          });
          item.addEventListener('dragleave', () => {
            item.classList.remove('is-drop-target');
          });
          item.addEventListener('drop', (event) => {
            event.preventDefault();
            item.classList.remove('is-drop-target');
            if (!draggingKey || draggingKey === key) {
              return;
            }
            const targetIndex = order.indexOf(key);
            order = DL.moveKeyInOrder(order, draggingKey, targetIndex);
            draggingKey = null;
            scroller.stop();
            renderList();
          });

          list.appendChild(item);
        });

        list.scrollTop = scrollTop;
      };

      renderList();

      const actions = createElement('div', 'dl-popover-actions');
      const selectAll = createButton('dl-link-btn', 'すべて選択');
      selectAll.addEventListener('click', () => {
        order.forEach((key) => visible.add(key));
        renderList();
      });
      actions.appendChild(selectAll);

      const clearAll = createButton('dl-link-btn', 'すべて解除');
      clearAll.addEventListener('click', () => {
        visible.clear();
        frozenColumnCount = 0;
        renderList();
      });
      actions.appendChild(clearAll);

      const resetButton = createButton('dl-link-btn', '初期状態に戻す');
      resetButton.addEventListener('click', () => {
        closePopover();
        if (handlers.onResetColumns) {
          handlers.onResetColumns();
        }
      });
      actions.appendChild(resetButton);

      popover.appendChild(actions);

      const footer = createElement('div', 'dl-popover-footer');
      const applyButton = createButton('dl-btn dl-btn-primary', '表示列を反映');
      applyButton.addEventListener('click', () => {
        if (handlers.onApplyColumns) {
          handlers.onApplyColumns({
            visibleKeys: order.filter((key) => visible.has(key)),
            columnOrder: order.slice(),
            frozenColumnCount
          });
        }
        closePopover();
      });
      footer.appendChild(applyButton);
      popover.appendChild(footer);

      positionPopover(anchor);
    };

    /* ================================================== 列ヘッダーの簡易フィルタ */

    const openColumnFilter = (column, anchor) => {
      closeSidePanel();
      popover.textContent = '';
      popover.className = 'dl-popover dl-popover-column-filter';

      const filters = context.getFilters();
      const existing = (filters.conditions || []).find((condition) => condition.key === column.key && condition.op === 'in');
      const existingEmpty = (filters.conditions || []).find((condition) => condition.key === column.key && condition.op === 'empty');
      const selected = new Set(existing ? existing.value : []);
      let emptyChecked = Boolean(existingEmpty);

      popover.appendChild(createElement('div', 'dl-popover-title', column.label));

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'dl-input';
      searchInput.placeholder = '値を検索';
      popover.appendChild(searchInput);

      const result = context.getTokenOptions(column);
      const list = createElement('div', 'dl-token-list dl-token-list-tall');
      popover.appendChild(list);

      const conflictNote = createElement('p', 'dl-note dl-note-warn', '空欄と値は同時に指定できないため、選択した値を優先します。');
      conflictNote.hidden = true;
      popover.appendChild(conflictNote);

      const updateConflictNote = () => {
        conflictNote.hidden = !(emptyChecked && selected.size > 0);
      };

      const renderOptions = () => {
        list.textContent = '';
        const keyword = searchInput.value.trim().toLowerCase();

        if (result.hasEmpty && !keyword) {
          const item = createElement('label', 'dl-token-item');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = emptyChecked;
          checkbox.addEventListener('change', () => {
            emptyChecked = checkbox.checked;
            updateConflictNote();
          });
          item.appendChild(checkbox);
          item.appendChild(createElement('span', 'dl-token-label dl-token-empty', '（空欄）'));
          list.appendChild(item);
        }

        const filtered = keyword
          ? result.options.filter((option) => option.label.toLowerCase().indexOf(keyword) >= 0)
          : result.options;

        if (filtered.length === 0) {
          list.appendChild(createElement('p', 'dl-note', '該当する値がありません。'));
          return;
        }

        filtered.forEach((option) => {
          const item = createElement('label', 'dl-token-item');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = selected.has(option.token);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              selected.add(option.token);
            } else {
              selected.delete(option.token);
            }
            updateConflictNote();
          });
          item.appendChild(checkbox);
          item.appendChild(createElement('span', 'dl-token-label', option.label));
          if (option.count > 0) {
            item.appendChild(createElement('span', 'dl-token-count', String(option.count)));
          }
          list.appendChild(item);
        });
      };

      renderOptions();
      updateConflictNote();
      searchInput.addEventListener('input', renderOptions);

      const footer = createElement('div', 'dl-popover-footer');

      const clearButton = createButton('dl-btn', 'この列の条件を解除');
      clearButton.addEventListener('click', () => {
        closePopover();
        if (handlers.onApplyColumnFilter) {
          handlers.onApplyColumnFilter(column, { tokens: [], empty: false });
        }
      });
      footer.appendChild(clearButton);

      const applyButton = createButton('dl-btn dl-btn-primary', 'この条件を反映');
      applyButton.addEventListener('click', () => {
        if (handlers.onApplyColumnFilter) {
          handlers.onApplyColumnFilter(column, {
            tokens: Array.from(selected),
            empty: emptyChecked && selected.size === 0
          });
        }
        closePopover();
      });
      footer.appendChild(applyButton);
      popover.appendChild(footer);

      positionPopover(anchor);
      searchInput.focus();
    };

    return {
      openFilterPanel,
      openColumnPanel,
      openColumnFilter,
      closeAll,
      destroy() {
        globalListeners.forEach(({ type, handler }) => document.removeEventListener(type, handler));
        globalListeners.length = 0;
        overlay.remove();
        sidePanel.remove();
        popover.remove();
      }
    };
  };
})(window.SubtableList);
