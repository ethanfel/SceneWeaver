export async function projectMutationOptions(node, project, options) {
  if (node.widgets.find(item => item.name === 'run_name')?.value !== project) throw new Error('Wrong project');
  return { ...options, headers: { ...options.headers, 'X-H3-Workflow-Owner': 'test-native-owner' } };
}
