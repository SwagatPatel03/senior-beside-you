// Adapt Codex hook payloads to the recorder's edit/command inputs.
export function patchEdits(command) {
  const edits = [];
  let edit;
  for (const line of String(command || '').split(/\r?\n/)) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      edit = { file_path: header[2], old_string: '', new_string: '' };
      edits.push(edit);
    } else if (edit && line.startsWith('*** Move to: ')) {
      edits.push({ file_path: line.slice(13), old_string: '', new_string: '' });
    } else if (edit && !line.startsWith('***') && !line.startsWith('@@')) {
      if (line.startsWith('-')) edit.old_string += `${line.slice(1)}\n`;
      else if (line.startsWith('+')) edit.new_string += `${line.slice(1)}\n`;
      else if (line.startsWith(' ')) {
        edit.old_string += `${line.slice(1)}\n`;
        edit.new_string += `${line.slice(1)}\n`;
      }
    }
  }
  return edits;
}

export function normalizeInput(input) {
  const name = String(input.tool_name || '').replace(/^functions[.]/, '');
  const ti = typeof input.tool_input === 'string' ? { command: input.tool_input } : (input.tool_input || {});
  if (name === 'apply_patch') {
    const edits = patchEdits(ti.command || ti.patch || ti.input);
    const response = input.tool_response;
    const failed = typeof response === 'string' && /^(?:Error:|Failed to|apply_patch verification failed)/i.test(response);
    return { ...input, tool_response: failed ? { isError: true, output: response } : response, tool_name: 'Edit', tool_input: edits[0] || {}, senior_edits: edits };
  }
  if (['exec_command', 'shell_command', 'shell', 'Bash', 'PowerShell', 'write_stdin'].includes(name)) {
    const command = ti.command || ti.cmd || '';
    return { ...input, tool_name: 'Bash', tool_input: { ...ti, command: Array.isArray(command) ? command.join(' ') : command } };
  }
  if (['spawn_agent', 'send_message', 'wait_agent'].includes(name)) {
    return { ...input, tool_name: 'Agent', tool_input: { ...ti, description: ti.message || 'Preparing the next step' } };
  }
  return { ...input, tool_input: ti };
}
